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
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
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
	// 같은 REST 키로 쓰는 나머지 Local API — 반경 갈래별 장소, 좌표→주소·행정구역.
	kakaoCategoryURL     = "https://dapi.kakao.com/v2/local/search/category.json"
	kakaoCoordAddressURL = "https://dapi.kakao.com/v2/local/geo/coord2address.json"
	kakaoCoordRegionURL  = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
	// 자동차 길찾기만 Local API 가 아닌 카카오모빌리티 쪽이다(launcher.cs KakaoDirectionsEndpoint 와 같은 자리).
	kakaoDirectionsURL = "https://apis-navi.kakaomobility.com/v1/directions"
	geocoderEnv        = "CLASSDOCK_GEOCODER_URL"
	// 장소 이름 검색으로 돌려줄 후보 수. 화면 목록(map-viewer.js MAP_SEARCH_RESULT_MAX)·C# 런처
	// (launcher.cs GeocodeResultLimit)와 같은 값이어야 한다 — 한쪽만 올리면 다른 쪽에서 잘린다.
	geocodeResultLimit = "8"
	geocodeMaxBytes    = 512 * 1024
	// 길찾기는 roads[].vertexes 전체를 돌려주므로 장거리·경유지의 정상 응답을 위한 전용 상한을 둔다.
	directionsMaxBytes = 8 * 1024 * 1024

	/* ===== 환율 =====
	   launcher.cs 의 같은 이름 상수와 짝이다. 타일과 같은 이유로 런처가 대신 받는다 —
	   수출입은행은 CORS 를 열지 않고, 포트가 매번 바뀌어 브라우저 저장소는 다음 수업까지 남지 않는다.
	   받아 온 JSON 은 그대로 돌려주고 뜻풀이는 src/js/exchange-rate.js 한 곳에만 둔다. */
	koreaEximRateURL  = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON"
	ecbRateURL        = "https://api.frankfurter.dev/v1/"
	rateMaxBytes      = 512 * 1024
	rateCacheMaxBytes = 20 * 1024 * 1024
	rateTodayCacheAge = 20 * time.Minute // 지난 날짜 값은 안 바뀐다 — 오늘 값만 다시 받아 본다
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
	rateCacheMu       sync.Mutex
	rateKeyMu         sync.RWMutex
	// 이 런처는 DPAPI 가 없는 곳(Windows 밖)에서도 돌아야 해서 인증키를 파일로 남기지 않는다.
	// 카카오 키와 같은 규칙이며, 상태 응답의 persistentSupported 가 false 인 까닭이다.
	exchangeRateKey string
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
/*
좌표로 부르는 요청(반경 시설·좌표→주소)의 딸린 값. 브라우저가 보낸 문자열을 그대로 URL 에 붙이지
않고 숫자·코드 꼴만 통과시킨다(launcher.cs 의 GeocodeSpot 과 같은 규칙).
*/
type geocodeSpot struct {
	x, y, radius, category, page string
	// 길찾기만 점이 둘 이상이다 — 도착점(x2·y2)과 사이에 들르는 곳(via, "x,y|x,y" 꼴).
	x2, y2, via           string
	priority, avoid, fuel string
	hipass, alternatives  string
}

func (s geocodeSpot) hasPoint() bool { return s.x != "" && s.y != "" }
func (s geocodeSpot) hasEnd() bool   { return s.x2 != "" && s.y2 != "" }
func (s geocodeSpot) cacheKey() string {
	return s.x + "|" + s.y + "|" + s.radius + "|" + s.category + "|" + s.page +
		"|" + s.x2 + "|" + s.y2 + "|" + s.via + "|" + s.priority + "|" + s.avoid +
		"|" + s.fuel + "|" + s.hipass + "|" + s.alternatives
}

func geocodeNumber(value string, min, max float64) string {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < min || parsed > max {
		return ""
	}
	return strconv.FormatFloat(parsed, 'f', -1, 64)
}

/*
들르는 곳 목록("x,y|x,y")도 좌표와 같은 규칙으로 다시 짠다 — 브라우저가 보낸 글자를 그대로

	붙이지 않고 숫자로 읽힌 것만 카카오가 받는 꼴로 되돌려 준다. 카카오 상한이 5 개다.
*/
const geocodeViaMax = 5

func geocodeVia(raw string) string {
	points := []string{}
	for _, piece := range strings.Split(raw, "|") {
		if len(points) >= geocodeViaMax {
			break
		}
		parts := strings.Split(piece, ",")
		if len(parts) != 2 {
			continue
		}
		x := geocodeNumber(parts[0], -180, 180)
		y := geocodeNumber(parts[1], -85, 85)
		if x == "" || y == "" {
			continue
		}
		points = append(points, x+","+y)
	}
	return strings.Join(points, "|")
}

func directionsChoice(raw, fallback string, allowed ...string) string {
	value := strings.TrimSpace(raw)
	for _, item := range allowed {
		if strings.EqualFold(value, item) {
			return item
		}
	}
	return fallback
}

func directionsAvoid(raw string) string {
	requested := map[string]bool{}
	for _, value := range strings.Split(raw, "|") {
		requested[strings.ToLower(strings.TrimSpace(value))] = true
	}
	clean := []string{}
	for _, item := range []string{"ferries", "toll", "motorway", "schoolzone", "uturn"} {
		if requested[item] {
			clean = append(clean, item)
		}
	}
	return strings.Join(clean, "|")
}

func readGeocodeSpot(query url.Values) geocodeSpot {
	spot := geocodeSpot{
		x:            geocodeNumber(query.Get("x"), -180, 180),
		y:            geocodeNumber(query.Get("y"), -85, 85),
		radius:       geocodeNumber(query.Get("radius"), 1, 20000), // 카카오 반경 상한
		page:         geocodeNumber(query.Get("page"), 1, 3),
		x2:           geocodeNumber(query.Get("x2"), -180, 180),
		y2:           geocodeNumber(query.Get("y2"), -85, 85),
		via:          geocodeVia(query.Get("via")),
		priority:     directionsChoice(query.Get("priority"), "RECOMMEND", "RECOMMEND", "TIME", "DISTANCE"),
		avoid:        directionsAvoid(query.Get("avoid")),
		fuel:         directionsChoice(query.Get("fuel"), "GASOLINE", "GASOLINE", "DIESEL", "LPG"),
		hipass:       directionsChoice(query.Get("hipass"), "false", "true", "false"),
		alternatives: directionsChoice(query.Get("alternatives"), "false", "true", "false"),
	}
	// 카카오 카테고리 코드는 언제나 영문 두 글자 + 숫자 한 글자다(SC4·CS2 …).
	category := strings.ToUpper(strings.TrimSpace(query.Get("category")))
	if len(category) == 3 && category[0] >= 'A' && category[0] <= 'Z' &&
		category[1] >= 'A' && category[1] <= 'Z' && category[2] >= '0' && category[2] <= '9' {
		spot.category = category
	}
	return spot
}

func fetchGeocode(query, provider, kakaoKey string, spot geocodeSpot) ([]byte, string) {
	kakao := strings.HasPrefix(provider, "kakao-")
	if !kakao {
		geocodeMu.Lock()
		if waited := time.Since(geocodeLast); waited < geocodeMinGap {
			time.Sleep(geocodeMinGap - waited)
		}
		geocodeLast = time.Now()
		geocodeMu.Unlock()
	}

	var endpoint string
	if provider == "kakao-coord2address" || provider == "kakao-coord2region" {
		endpoint = kakaoCoordAddressURL
		if provider == "kakao-coord2region" {
			endpoint = kakaoCoordRegionURL
		}
		values := url.Values{}
		values.Set("x", spot.x)
		values.Set("y", spot.y)
		endpoint += "?" + values.Encode()
	} else if provider == "kakao-directions" {
		values := url.Values{}
		values.Set("origin", spot.x+","+spot.y)
		values.Set("destination", spot.x2+","+spot.y2)
		if spot.via != "" {
			values.Set("waypoints", spot.via)
		}
		values.Set("priority", spot.priority)
		if spot.avoid != "" {
			values.Set("avoid", spot.avoid)
		}
		values.Set("car_fuel", spot.fuel)
		values.Set("car_hipass", spot.hipass)
		values.Set("alternatives", spot.alternatives)
		values.Set("road_details", "false")
		values.Set("summary", "false")
		endpoint = kakaoDirectionsURL + "?" + values.Encode()
	} else if provider == "kakao-category" {
		radius := spot.radius
		if radius == "" {
			radius = "1000"
		}
		page := spot.page
		if page == "" {
			page = "1"
		}
		values := url.Values{}
		values.Set("category_group_code", spot.category)
		values.Set("x", spot.x)
		values.Set("y", spot.y)
		values.Set("radius", radius)
		values.Set("size", "15")
		values.Set("sort", "distance")
		values.Set("page", page)
		endpoint = kakaoCategoryURL + "?" + values.Encode()
	} else if kakao {
		endpoint = kakaoAddressURL
		if provider == "kakao-keyword" {
			endpoint = kakaoKeywordURL
		}
		values := url.Values{}
		values.Set("size", geocodeResultLimit)
		values.Set("query", query)
		// 키워드 검색에 기준점이 오면 그 둘레만 본다 — 갈래에 없는 말로 주변 시설을 찾는
		// 길이라(로또·빵집 …) 갈래 검색과 같은 쪽수(15개·페이지)로 받는다.
		if provider == "kakao-keyword" && spot.hasPoint() {
			values.Set("size", "15")
			values.Set("x", spot.x)
			values.Set("y", spot.y)
			values.Set("sort", "distance")
			page := spot.page
			if page == "" {
				page = "1"
			}
			values.Set("page", page)
			if spot.radius != "" {
				values.Set("radius", spot.radius)
			}
		}
		endpoint += "?" + values.Encode()
	} else if provider == "osm-reverse" {
		// Nominatim 의 역지오코딩은 같은 서버의 이웃 경로다(/search → /reverse).
		endpointURL := strings.TrimSpace(os.Getenv(geocoderEnv))
		if endpointURL == "" {
			endpointURL = defaultGeocoder
		}
		parsedEndpoint, err := url.Parse(endpointURL)
		if err != nil || parsedEndpoint.Scheme != "https" || parsedEndpoint.Hostname() == "" {
			parsedEndpoint, _ = url.Parse(defaultGeocoder)
		}
		parsedEndpoint.Path = strings.TrimSuffix(parsedEndpoint.Path, "/search") + "/reverse"
		parsedEndpoint.Fragment = ""
		values := url.Values{}
		values.Set("format", "jsonv2")
		values.Set("zoom", "18")
		values.Set("accept-language", "ko")
		values.Set("lat", spot.y)
		values.Set("lon", spot.x)
		parsedEndpoint.RawQuery = values.Encode()
		endpoint = parsedEndpoint.String()
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
		values.Set("limit", geocodeResultLimit)
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
	maxBytes := geocodeMaxBytes
	if provider == "kakao-directions" {
		maxBytes = directionsMaxBytes
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, int64(maxBytes)+1))
	if err != nil || len(data) > maxBytes {
		return nil, "geocode-failed"
	}
	return data, ""
}

var geocodeProviders = []string{
	"osm", "osm-reverse", "kakao-address", "kakao-keyword",
	"kakao-category", "kakao-coord2address", "kakao-coord2region", "kakao-directions",
}

func geocodePlace(query, requestedProvider string, spot geocodeSpot) ([]byte, string) {
	query = strings.TrimSpace(query)
	provider := "osm"
	for _, candidate := range geocodeProviders {
		if requestedProvider == candidate {
			provider = candidate
			break
		}
	}
	// 좌표로 부르는 갈래는 검색어 대신 기준점이 있어야 한다.
	needsPoint := provider == "kakao-category" || provider == "kakao-coord2address" ||
		provider == "kakao-coord2region" || provider == "osm-reverse" || provider == "kakao-directions"
	if needsPoint {
		if !spot.hasPoint() {
			return nil, "geocode-bad-point"
		}
		if provider == "kakao-category" && spot.category == "" {
			return nil, "geocode-bad-category"
		}
		// 길찾기는 출발점만으로는 뜻이 없다 — 도착점이 빠지면 카카오에 묻지 않고 여기서 끊는다.
		if provider == "kakao-directions" && !spot.hasEnd() {
			return nil, "geocode-bad-point"
		}
	} else if query == "" || len(query) > 200 {
		return nil, "geocode-bad-query"
	}
	key := ""
	if strings.HasPrefix(provider, "kakao-") {
		key = currentKakaoMapKey()
		if key == "" {
			return nil, "kakao-key-required"
		}
	}
	cacheKey := provider + "\n" + query + "\n" + spot.cacheKey()
	// 길찾기는 현재 교통 정보가 바뀌므로 런처의 무기한 장소 검색 캐시에 넣지 않는다.
	cacheable := provider != "kakao-directions"
	if cacheable {
		geocodeMu.Lock()
		cached, ok := geocodeCache[cacheKey]
		geocodeMu.Unlock()
		if ok {
			return cached, ""
		}
	}
	data, code := fetchGeocode(query, provider, key, spot)
	if code != "" {
		return nil, code
	}
	if cacheable {
		geocodeMu.Lock()
		if len(geocodeCache) > 200 {
			geocodeCache = map[string][]byte{}
		}
		geocodeCache[cacheKey] = data
		geocodeMu.Unlock()
	}
	return data, ""
}

/* ===== 환율 ===== */

// 캐시 자리는 launcher.cs 의 RateCacheDir 과 같은 폴더다 — 두 런처를 번갈아 써도 받아 둔 값을 이어 쓴다.
func rateCacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "ClassDock", "rate-cache")
}

func validExchangeRateKey(value string) bool {
	key := strings.TrimSpace(value)
	if len(key) < 12 || len(key) > 128 {
		return false
	}
	for _, ch := range key {
		if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func currentExchangeRateKey() string {
	rateKeyMu.RLock()
	defer rateKeyMu.RUnlock()
	return exchangeRateKey
}

func setExchangeRateKey(value string) {
	rateKeyMu.Lock()
	exchangeRateKey = strings.TrimSpace(value)
	rateKeyMu.Unlock()
}

type rateQuery struct {
	source  string
	date    string // koreaexim: YYYYMMDD · ecb: YYYY-MM-DD
	start   string
	end     string
	symbols string
}

func (q rateQuery) cacheKey() string {
	return q.source + "|" + q.date + "|" + q.start + "|" + q.end + "|" + q.symbols
}

// 캐시를 영구로 둘지 가르는 기준일 — 조회 구간에서 가장 나중 날짜.
func (q rateQuery) newestDay() string {
	if q.end != "" {
		return q.end
	}
	return q.date
}

func rateDate(value string, compact bool) string {
	text := strings.TrimSpace(value)
	layout := "2006-01-02"
	if compact {
		layout = "20060102"
	}
	if _, err := time.Parse(layout, text); err != nil {
		return ""
	}
	return text
}

func rateSymbols(value string) string {
	text := strings.ToUpper(strings.TrimSpace(value))
	if text == "" || len(text) > 60 {
		return ""
	}
	for _, part := range strings.Split(text, ",") {
		if len(part) < 3 || len(part) > 4 {
			return ""
		}
		for _, ch := range part {
			if ch < 'A' || ch > 'Z' {
				return ""
			}
		}
	}
	return text
}

// 브라우저가 보낸 문자열을 URL 에 그대로 붙이지 않고 여기서 꼴부터 맞춘다(readGeocodeSpot 과 같은 규칙).
func readRateQuery(query url.Values) (rateQuery, string) {
	q := rateQuery{source: strings.TrimSpace(query.Get("source"))}
	if q.source != "koreaexim" && q.source != "ecb" && q.source != "ecb-series" {
		return rateQuery{}, "rate-bad-request"
	}
	if q.source == "ecb-series" {
		q.start = rateDate(query.Get("start"), false)
		q.end = rateDate(query.Get("end"), false)
		q.symbols = rateSymbols(query.Get("symbols"))
		if q.start == "" || q.end == "" || q.symbols == "" || q.start > q.end {
			return rateQuery{}, "rate-bad-request"
		}
		return q, ""
	}
	q.date = rateDate(query.Get("date"), q.source == "koreaexim")
	if q.date == "" {
		return rateQuery{}, "rate-bad-request"
	}
	return q, ""
}

func rateCacheFile(key string) string {
	sum := sha256.Sum256([]byte(key))
	return filepath.Join(rateCacheDir(), hex.EncodeToString(sum[:])+".json")
}

// 지난 날짜의 값은 다시 바뀌지 않으므로 그대로 믿고, 오늘 값만 20분이 지나면 새로 받는다.
// '오늘' 은 이 PC 의 달력 날짜다 — 수출입은행 고시가 한국 시간 기준이고 교실 PC 도 같은 시간대다.
func rateCacheFresh(q rateQuery, writtenAt time.Time) bool {
	newest := strings.ReplaceAll(q.newestDay(), "-", "")
	if len(newest) == 8 && newest < time.Now().Format("20060102") {
		return true
	}
	return time.Since(writtenAt) <= rateTodayCacheAge
}

func readCachedRate(q rateQuery) ([]byte, bool, bool) {
	rateCacheMu.Lock()
	defer rateCacheMu.Unlock()
	path := rateCacheFile(q.cacheKey())
	info, err := os.Stat(path)
	if err != nil {
		return nil, false, false
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return nil, false, false
	}
	return data, rateCacheFresh(q, info.ModTime()), true
}

// 잘못을 담은 응답은 캐시하지 않는다 — 인증 오류(result 3)나 아직 고시 전인 빈 배열을 디스크에
// 남기면 키를 고치거나 11시가 지난 뒤에도 같은 잘못이 계속 되살아난다.
func rateBodyCacheable(data []byte) bool {
	if len(data) < 8 {
		return false
	}
	text := string(data)
	if strings.TrimSpace(text) == "[]" {
		return false
	}
	return !strings.Contains(text, `"result":2`) &&
		!strings.Contains(text, `"result":3`) &&
		!strings.Contains(text, `"result":4`)
}

func writeCachedRate(q rateQuery, data []byte) {
	if !rateBodyCacheable(data) {
		return
	}
	rateCacheMu.Lock()
	defer rateCacheMu.Unlock()
	dir := rateCacheDir()
	if os.MkdirAll(dir, 0o755) != nil {
		return
	}
	path := rateCacheFile(q.cacheKey())
	temp := path + ".tmp"
	if os.WriteFile(temp, data, 0o644) != nil {
		return
	}
	if os.Rename(temp, path) != nil {
		os.Remove(temp)
		return
	}
	sweepRateCache(dir)
}

// 하루치 JSON 이 10KB 남짓이라 좀처럼 차지 않지만, 기간 조회를 반복하면 늘어난다 — 오래된 것부터 지운다.
func sweepRateCache(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type cached struct {
		path    string
		size    int64
		modTime time.Time
	}
	files := []cached{}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, cached{filepath.Join(dir, entry.Name()), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= rateCacheMaxBytes {
		return
	}
	sort.Slice(files, func(a, b int) bool { return files[a].modTime.Before(files[b].modTime) })
	target := int64(float64(rateCacheMaxBytes) * 0.8)
	for _, file := range files {
		if total <= target {
			break
		}
		if os.Remove(file.path) == nil {
			total -= file.size
		}
	}
}

func fetchExchangeRate(q rateQuery, key string) ([]byte, string) {
	var endpoint string
	switch q.source {
	case "koreaexim":
		endpoint = koreaEximRateURL + "?authkey=" + url.QueryEscape(key) + "&searchdate=" + q.date + "&data=AP01"
	case "ecb-series":
		endpoint = ecbRateURL + q.start + ".." + q.end + "?symbols=" + q.symbols
	default:
		endpoint = ecbRateURL + q.date
	}
	request, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, "rate-failed"
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, "rate-failed"
	}
	defer response.Body.Close()
	// Frankfurter 는 자료가 없는 날짜에 404 로 답한다 — 연결이 끊긴 것과 구분해야
	// "인터넷을 확인하세요" 라는 엉뚱한 안내가 뜨지 않는다.
	if response.StatusCode == http.StatusNotFound {
		return nil, "rate-no-data"
	}
	if response.StatusCode != http.StatusOK {
		return nil, "rate-failed"
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, rateMaxBytes+1))
	if err != nil {
		return nil, "rate-failed"
	}
	if len(data) > rateMaxBytes {
		return nil, "rate-too-large"
	}
	return data, ""
}

// 캐시 → 없거나 낡았으면 새로 받기 → 받기에 실패하면 낡은 캐시라도 돌려주기(타일 프록시와 같은 순서).
// 두 번째 반환값 true 는 "받아오지 못해 저장해 둔 값을 대신 내준다" 는 뜻이고,
// 화면은 X-ClassDock-Rate-Cached 헤더를 보고 '저장본' 이라고 밝힌다.
func exchangeRate(q rateQuery) ([]byte, bool, string) {
	key := ""
	if q.source == "koreaexim" {
		key = currentExchangeRateKey()
		if key == "" {
			return nil, false, "rate-key-required"
		}
	}
	stored, fresh, hasStored := readCachedRate(q)
	if hasStored && fresh {
		return stored, false, ""
	}
	data, code := fetchExchangeRate(q, key)
	if code == "" {
		writeCachedRate(q, data)
		return data, false, ""
	}
	if hasStored {
		return stored, true, ""
	}
	return nil, false, code
}

// 키 시험용 — 어제부터 거슬러 올라가 처음 만나는 평일(YYYYMMDD). 오늘로 걸면 주말이나
// 오전 고시 전에는 키가 멀쩡해도 빈 배열이 와서 "키가 틀렸다" 고 잘못 알린다.
func lastWeekdayCompact() string {
	day := time.Now().AddDate(0, 0, -1)
	for i := 0; i < 7; i++ {
		if day.Weekday() != time.Saturday && day.Weekday() != time.Sunday {
			break
		}
		day = day.AddDate(0, 0, -1)
	}
	return day.Format("20060102")
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
		data, code := geocodePlace(r.URL.Query().Get("q"), r.URL.Query().Get("provider"), readGeocodeSpot(r.URL.Query()))
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

	// 환율 창이 "이 런처가 환율을 대신 받아 주는가" 를 묻는 자리. 타일 프록시와 다른 능력이라 따로 둔다.
	mux.HandleFunc("/can-proxy-rates", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) {
			http.Error(w, "invalid-host", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("yes"))
	})

	mux.HandleFunc("/exchange-rate", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) {
			http.Error(w, "invalid-host", http.StatusForbidden)
			return
		}
		query, code := readRateQuery(r.URL.Query())
		if code != "" {
			http.Error(w, code, http.StatusBadRequest)
			return
		}
		data, cached, code := exchangeRate(query)
		if code != "" {
			status := http.StatusBadGateway
			if code == "rate-key-required" {
				status = http.StatusPreconditionRequired
			}
			http.Error(w, code, status)
			return
		}
		if cached {
			w.Header().Set("X-ClassDock-Rate-Cached", "1")
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(data)
	})

	mux.HandleFunc("/exchange-rate-key-status", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method-not-allowed", http.StatusMethodNotAllowed)
			return
		}
		body, _ := json.Marshal(map[string]interface{}{
			"hasKey": currentExchangeRateKey() != "", "remembered": false, "persistentSupported": false,
		})
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(body)
	})

	mux.HandleFunc("/exchange-rate-key", func(w http.ResponseWriter, r *http.Request) {
		if !allowedLocalHost(r) || r.Header.Get("X-ClassDock-Action") != "1" {
			http.Error(w, "action-header-required", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodDelete {
			setExchangeRateKey("")
			w.Write([]byte("ok"))
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method-not-allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
		key := strings.TrimSpace(string(body))
		if err != nil || len(body) > 1024 || !validExchangeRateKey(key) {
			http.Error(w, "rate-key-invalid", http.StatusBadRequest)
			return
		}
		probe, code := fetchExchangeRate(rateQuery{source: "koreaexim", date: lastWeekdayCompact()}, key)
		if code != "" {
			http.Error(w, code, http.StatusBadRequest)
			return
		}
		if strings.Contains(string(probe), `"result":3`) {
			http.Error(w, "rate-key-invalid", http.StatusBadRequest)
			return
		}
		if strings.Contains(string(probe), `"result":4`) {
			http.Error(w, "rate-limit-reached", http.StatusBadRequest)
			return
		}
		setExchangeRateKey(key)
		w.Write([]byte("ok"))
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
		if _, code := fetchGeocode("서울특별시 중구 세종대로 110", "kakao-address", key, geocodeSpot{}); code != "" {
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
