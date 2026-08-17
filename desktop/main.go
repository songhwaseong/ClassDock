// ClassDock - 로컬 서버 런처
//
// 오프라인 HTML(app.html)을 바이너리에 내장하여,
// 실행 시 로컬(127.0.0.1)에 작은 웹서버를 띄우고 기본 브라우저를 자동으로 연다.
// 인터넷 연결이나 별도 설치 없이 .exe 더블클릭만으로 동작한다.
//
// 이 런처는 C# 컴파일러가 없는 PC(그리고 Windows 밖)를 위한 폴백이다. 파일 저장·파이썬 실행처럼
// launcher.cs 가 하는 일 대부분은 여기 없지만, 지도 배경 타일만은 서버가 대신 받아 줘야 한다 —
// 브라우저 저장소는 실행마다 포트(=origin)가 바뀌어 다음 수업까지 남지 않기 때문이다.
// 그래서 /tile-proxy 와 디스크 캐시, 그리고 장소 이름 검색(/geocode)까지는 여기에도 둔다.
package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed app.html
var content embed.FS

/*
===== 지도 타일 프록시 =====

	launcher.cs 의 TileProxyHosts 와 같은 목록이어야 한다. 한쪽만 늘리면 그 배경지도가 이 런처에서만
	회색으로 남는다(tests/map-viewer.test.js 가 두 파일을 함께 검사한다).
*/
var tileProxyHosts = []string{
	"tile.openstreetmap.org", "basemaps.cartocdn.com", "tile.opentopomap.org",
	"server.arcgisonline.com", "tiles.stadiamaps.com", "tile.thunderforest.com",
}

const (
	tileMaxBytes      = 2 * 1024 * 1024
	tileCacheMaxBytes = 400 * 1024 * 1024
	tileCacheMaxAge   = 7 * 24 * time.Hour
	geocodeMinGap     = 1100 * time.Millisecond
	userAgent         = "ClassDock/1.0 (local classroom app; https://github.com/songhwaseong/ClassDock)"
	defaultGeocoder   = "https://nominatim.openstreetmap.org/search"
	kakaoAddressURL   = "https://dapi.kakao.com/v2/local/search/address.json"
	kakaoKeywordURL   = "https://dapi.kakao.com/v2/local/search/keyword.json"
	geocoderEnv       = "CLASSDOCK_GEOCODER_URL"
)

var (
	tileDiskMu        sync.Mutex
	tileDiskBytes     int64 = -1
	geocodeMu         sync.Mutex
	geocodeLast       time.Time
	geocodeCache      = map[string][]byte{}
	mapSearchKeyMu    sync.RWMutex
	kakaoMapKey       string
	mapSearchProvider = "osm"
	httpClient        = &http.Client{Timeout: 15 * time.Second}
)

// 캐시 자리는 launcher.cs 와 같은 폴더를 쓴다(Windows 에서 %LOCALAPPDATA%\ClassDock\tile-cache).
// 두 런처를 번갈아 써도 받아 둔 지도를 그대로 이어서 쓸 수 있다.
func tileCacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "ClassDock", "tile-cache")
}

func tileHostAllowed(host string) bool {
	host = strings.ToLower(host)
	for _, candidate := range tileProxyHosts {
		if host == candidate || strings.HasSuffix(host, "."+candidate) {
			return true
		}
	}
	return false
}

func tileCachePath(rawURL, ext string) string {
	sum := sha256.Sum256([]byte(rawURL))
	key := hex.EncodeToString(sum[:])
	// 한 폴더에 수만 개가 쌓이지 않게 해시 앞 두 글자로 나눈다.
	return filepath.Join(tileCacheDir(), key[:2], key+ext)
}

func tileExtFor(mime string) string {
	mime = strings.ToLower(mime)
	if strings.Contains(mime, "jpeg") || strings.Contains(mime, "jpg") {
		return ".jpg"
	}
	if strings.Contains(mime, "webp") {
		return ".webp"
	}
	return ".png"
}

func readCachedTile(rawURL string) ([]byte, string, time.Time, bool) {
	for _, ext := range []string{".png", ".jpg", ".webp"} {
		path := tileCachePath(rawURL, ext)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil || len(data) == 0 {
			continue
		}
		mime := "image/png"
		if ext == ".jpg" {
			mime = "image/jpeg"
		} else if ext == ".webp" {
			mime = "image/webp"
		}
		return data, mime, info.ModTime(), true
	}
	return nil, "", time.Time{}, false
}

func tileCacheFresh(cachedAt time.Time) bool {
	return !cachedAt.IsZero() && time.Since(cachedAt) <= tileCacheMaxAge
}

func writeCachedTile(rawURL string, data []byte, mime string) {
	if len(data) == 0 {
		return
	}
	path := tileCachePath(rawURL, tileExtFor(mime))
	tileDiskMu.Lock()
	defer tileDiskMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	if tileDiskBytes < 0 {
		_, tileDiskBytes = walkTileCache()
	}
	var replacedBytes int64
	for _, ext := range []string{".png", ".jpg", ".webp"} {
		previous := tileCachePath(rawURL, ext)
		if info, err := os.Stat(previous); err == nil {
			if previous == path {
				replacedBytes += info.Size()
			} else if os.Remove(previous) == nil {
				replacedBytes += info.Size()
			}
		}
	}
	// 같은 타일을 동시에 받아도 반쯤 쓰인 파일이 남지 않게 임시 이름으로 쓰고 옮긴다.
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0o644); err != nil {
		return
	}
	if err := os.Rename(temp, path); err != nil {
		os.Remove(temp)
		return
	}
	tileDiskBytes = maxInt64(0, tileDiskBytes-replacedBytes) + int64(len(data))
	if tileDiskBytes > tileCacheMaxBytes {
		sweepTileCache()
	}
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

type cachedFile struct {
	path string
	size int64
	mod  time.Time
}

func walkTileCache() ([]cachedFile, int64) {
	var files []cachedFile
	var total int64
	filepath.Walk(tileCacheDir(), func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".png" && ext != ".jpg" && ext != ".webp" {
			return nil
		}
		files = append(files, cachedFile{path: path, size: info.Size(), mod: info.ModTime()})
		total += info.Size()
		return nil
	})
	return files, total
}

// 상한을 넘으면 오래 전에 받은 것부터 80% 아래로 내려갈 때까지 지운다.
func sweepTileCache() {
	files, total := walkTileCache()
	if total > tileCacheMaxBytes {
		sort.Slice(files, func(a, b int) bool { return files[a].mod.Before(files[b].mod) })
		target := int64(float64(tileCacheMaxBytes) * 0.8)
		for _, file := range files {
			if total <= target {
				break
			}
			if os.Remove(file.path) == nil {
				total -= file.size
			}
		}
	}
	tileDiskBytes = total
}

func proxyMapTile(rawURL string) ([]byte, string, bool) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || !tileHostAllowed(parsed.Host) {
		return nil, "", false
	}
	// 7일 안에 받은 타일은 그대로 쓴다. 만료된 타일은 새로 받되, 오프라인이면 아래의 stale
	// 복사본을 반환해 인터넷 없는 교실에서도 전에 본 지역은 계속 열리게 한다.
	staleData, staleMime, cachedAt, cached := readCachedTile(rawURL)
	if cached && tileCacheFresh(cachedAt) {
		return staleData, staleMime, true
	}
	request, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return staleData, staleMime, cached
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", "image/*")
	response, err := httpClient.Do(request)
	if err != nil {
		return staleData, staleMime, cached
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return staleData, staleMime, cached
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, tileMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > tileMaxBytes {
		return staleData, staleMime, cached
	}
	mime := response.Header.Get("Content-Type")
	if mime == "" {
		mime = "image/png"
	}
	writeCachedTile(rawURL, data, mime)
	return data, mime, true
}

func validKakaoMapKey(value string) bool {
	key := strings.TrimSpace(value)
	if len(key) < 16 || len(key) > 128 {
		return false
	}
	for _, ch := range key {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func currentKakaoMapKey() string {
	mapSearchKeyMu.RLock()
	defer mapSearchKeyMu.RUnlock()
	return kakaoMapKey
}

func setKakaoMapKey(value string) {
	mapSearchKeyMu.Lock()
	kakaoMapKey = strings.TrimSpace(value)
	mapSearchKeyMu.Unlock()
	geocodeMu.Lock()
	geocodeCache = map[string][]byte{}
	geocodeMu.Unlock()
}

func currentMapSearchProvider() string {
	mapSearchKeyMu.RLock()
	defer mapSearchKeyMu.RUnlock()
	return mapSearchProvider
}

func setMapSearchProvider(value string) {
	if value != "kakao" {
		value = "osm"
	}
	mapSearchKeyMu.Lock()
	mapSearchProvider = value
	mapSearchKeyMu.Unlock()
}

/*
===== 장소 이름 검색 =====

	OSM 은 식별 User-Agent 와 요청 간격을 런처에서 지키고, 카카오 키는 브라우저가 아닌 런처 메모리에
	둔다. Go 폴백은 OS 키 저장소를 가정할 수 없어 실행 중에만 기억한다.
*/
func fetchGeocode(query, provider, kakaoKey string) ([]byte, string) {
	kakao := provider == "kakao-address" || provider == "kakao-keyword"
	if !kakao {
		geocodeMu.Lock()
		if waited := time.Since(geocodeLast); waited < geocodeMinGap {
			time.Sleep(geocodeMinGap - waited)
		}
		geocodeLast = time.Now()
		geocodeMu.Unlock()
	}

	var endpoint string
	if kakao {
		endpoint = kakaoAddressURL
		if provider == "kakao-keyword" {
			endpoint = kakaoKeywordURL
		}
		values := url.Values{}
		values.Set("size", "5")
		values.Set("query", query)
		endpoint += "?" + values.Encode()
	} else {
		endpointURL := strings.TrimSpace(os.Getenv(geocoderEnv))
		if endpointURL == "" {
			endpointURL = defaultGeocoder
		}
		parsedEndpoint, err := url.Parse(endpointURL)
		if err != nil || parsedEndpoint.Scheme != "https" || parsedEndpoint.Hostname() == "" {
			parsedEndpoint, _ = url.Parse(defaultGeocoder)
		}
		parsedEndpoint.RawQuery = ""
		parsedEndpoint.Fragment = ""
		values := parsedEndpoint.Query()
		values.Set("format", "jsonv2")
		values.Set("limit", "5")
		values.Set("accept-language", "ko")
		values.Set("q", query)
		parsedEndpoint.RawQuery = values.Encode()
		endpoint = parsedEndpoint.String()
	}
	request, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, "geocode-failed"
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", "application/json")
	if kakao {
		request.Header.Set("Authorization", "KakaoAK "+kakaoKey)
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, "geocode-failed"
	}
	defer response.Body.Close()
	if kakao && (response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden) {
		return nil, "kakao-key-invalid"
	}
	if response.StatusCode != http.StatusOK {
		return nil, "geocode-failed"
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 512*1024+1))
	if err != nil || len(data) > 512*1024 {
		return nil, "geocode-failed"
	}
	return data, ""
}

func geocodePlace(query, requestedProvider string) ([]byte, string) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 200 {
		return nil, "geocode-bad-query"
	}
	provider := "osm"
	if requestedProvider == "kakao-address" || requestedProvider == "kakao-keyword" {
		provider = requestedProvider
	}
	key := ""
	if strings.HasPrefix(provider, "kakao-") {
		key = currentKakaoMapKey()
		if key == "" {
			return nil, "kakao-key-required"
		}
	}
	cacheKey := provider + "\n" + query
	geocodeMu.Lock()
	if cached, ok := geocodeCache[cacheKey]; ok {
		geocodeMu.Unlock()
		return cached, ""
	}
	geocodeMu.Unlock()
	data, code := fetchGeocode(query, provider, key)
	if code != "" {
		return nil, code
	}
	geocodeMu.Lock()
	if len(geocodeCache) > 200 {
		geocodeCache = map[string][]byte{}
	}
	geocodeCache[cacheKey] = data
	geocodeMu.Unlock()
	return data, ""
}

// loopback 에만 바인딩하더라도 DNS rebinding 등으로 다른 Host 가 들어오는 요청은 받지 않는다.
func allowedLocalHost(r *http.Request) bool {
	host := r.Host
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	return host == "127.0.0.1" || host == "localhost"
}

// 기본 브라우저로 url 열기 (OS별 처리)
func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = exec.Command("xdg-open", url).Start()
	}
	if err != nil {
		log.Println("브라우저 자동 실행 실패:", err)
	}
}

func main() {
	page, err := fs.ReadFile(content, "app.html")
	if err != nil {
		log.Fatal("내장 페이지를 읽지 못했습니다:", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	// 헬스체크/종료 신호 등 확장 여지
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// 지도 문서가 "이 런처가 타일을 대신 받아 디스크에 남겨 주는가"를 묻는 자리.
	// 파일 저장 가능 여부(/can-save-file)와는 다른 능력이다 — 이 런처는 저장은 못 해도 타일은 받는다.
	mux.HandleFunc("/can-proxy-tiles", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) {
			http.Error(w, "invalid-host", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("yes"))
	})

	mux.HandleFunc("/tile-proxy", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) {
			http.Error(w, "invalid-host", http.StatusForbidden)
			return
		}
		// 지도 스냅샷의 sandbox iframe 은 Origin: null 로 부른다 — 목적지 허용목록이 경계이므로 열어 둔다.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		data, mime, ok := proxyMapTile(r.URL.Query().Get("u"))
		if !ok {
			http.Error(w, "tile-proxy-failed", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", mime)
		w.Write(data)
	})

	mux.HandleFunc("/tile-cache-status", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		tileDiskMu.Lock()
		files, total := walkTileCache()
		tileDiskBytes = total
		tileDiskMu.Unlock()
		body, _ := json.Marshal(map[string]interface{}{
			"files": len(files), "bytes": total, "maxBytes": int64(tileCacheMaxBytes),
		})
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(body)
	})

	mux.HandleFunc("/tile-cache-clear", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Method != "POST" || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		tileDiskMu.Lock()
		err := os.RemoveAll(tileCacheDir())
		tileDiskBytes = 0
		tileDiskMu.Unlock()
		if err != nil {
			http.Error(w, "tile-cache-clear-failed", http.StatusInternalServerError)
			return
		}
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("/geocode", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) {
			http.Error(w, "invalid-host", http.StatusForbidden)
			return
		}
		data, code := geocodePlace(r.URL.Query().Get("q"), r.URL.Query().Get("provider"))
		if code != "" {
			status := http.StatusBadGateway
			if code == "kakao-key-required" {
				status = http.StatusPreconditionRequired
			}
			http.Error(w, code, status)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(data)
	})

	mux.HandleFunc("/map-search-key-status", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method-not-allowed", http.StatusMethodNotAllowed)
			return
		}
		body, _ := json.Marshal(map[string]interface{}{
			"hasKey": currentKakaoMapKey() != "", "remembered": false, "persistentSupported": false,
			"provider": currentMapSearchProvider(),
		})
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(body)
	})

	mux.HandleFunc("/map-search-key", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodDelete {
			setKakaoMapKey("")
			setMapSearchProvider("osm")
			w.Write([]byte("ok"))
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method-not-allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
		key := strings.TrimSpace(string(body))
		if err != nil || len(body) > 1024 || !validKakaoMapKey(key) {
			http.Error(w, "kakao-key-invalid", http.StatusBadRequest)
			return
		}
		if _, code := fetchGeocode("서울특별시 중구 세종대로 110", "kakao-address", key); code != "" {
			http.Error(w, code, http.StatusBadRequest)
			return
		}
		setKakaoMapKey(key)
		setMapSearchProvider("kakao")
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("/map-search-provider", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method-not-allowed", http.StatusMethodNotAllowed)
			return
		}
		setMapSearchProvider(r.URL.Query().Get("value"))
		w.Write([]byte("ok"))
	})

	// 127.0.0.1 의 빈 포트에 바인딩 (외부에는 노출되지 않음)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal("포트 바인딩 실패:", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	serverURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	fmt.Println("============================================")
	fmt.Println("  ClassDock 실행 중")
	fmt.Println("============================================")
	fmt.Println("  주소 :", serverURL)
	fmt.Println("  브라우저가 자동으로 열립니다.")
	fmt.Println("  종료하려면 이 창을 닫으세요. (Ctrl+C)")
	fmt.Println("============================================")

	// 서버가 뜬 직후 브라우저 열기
	go func() {
		time.Sleep(400 * time.Millisecond)
		openBrowser(serverURL)
	}()

	if err := http.Serve(ln, mux); err != nil {
		log.Fatal(err)
	}
}
