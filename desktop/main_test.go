package main

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type tileTestTransport func(*http.Request) (*http.Response, error)

func (f tileTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func waitTileRefresh(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tileRefreshMu.Lock()
		pending := len(tileRefreshPending)
		tileRefreshMu.Unlock()
		if pending == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("tile refresh did not finish")
}

func setupTileCacheTest(t *testing.T, transport tileTestTransport) {
	t.Helper()
	// Windows os.UserCacheDir uses LocalAppData. These tests never touch the user's cache.
	tempRoot, err := filepath.Abs(filepath.Join("..", ".tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tempRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	cacheRoot, err := os.MkdirTemp(tempRoot, "go-tile-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if filepath.Dir(cacheRoot) != tempRoot {
			t.Fatal("test cache escaped temporary directory")
		}
		if err := os.RemoveAll(cacheRoot); err != nil {
			t.Error(err)
		}
	})
	t.Setenv("LocalAppData", cacheRoot)
	t.Setenv("XDG_CACHE_HOME", cacheRoot)
	if err := clearTileCache(); err != nil {
		t.Fatal(err)
	}
	previous := httpClient
	httpClient = &http.Client{Transport: transport}
	t.Cleanup(func() { waitTileRefresh(t); httpClient = previous })
}

func seedExpiredTile(t *testing.T, rawURL string) {
	t.Helper()
	writeCachedTile(rawURL, []byte("old"), "image/webp")
	expired := time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(tileCachePath(rawURL, ".webp"), expired, expired); err != nil {
		t.Fatal(err)
	}
}

func tileTestResponse(status int) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"image/png"}}, Body: io.NopCloser(bytes.NewBufferString("new"))}
}

func TestExpiredTileReturnsBeforeRefreshAndDeduplicates(t *testing.T) {
	started, release := make(chan struct{}, 1), make(chan struct{})
	var calls atomic.Int32
	setupTileCacheTest(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		started <- struct{}{}
		<-release
		return tileTestResponse(200), nil
	})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	url := "https://tile.waymarkedtrails.org/cycling/13/1/2.png"
	seedExpiredTile(t, url)
	returned := make(chan bool, 1)
	go func() {
		data, mime, ok := proxyMapTile(url)
		returned <- ok && string(data) == "old" && mime == "image/webp"
	}()
	select {
	case ok := <-returned:
		if !ok {
			t.Fatal("did not return the stored tile")
		}
	case <-time.After(time.Second):
		t.Fatal("stored tile waited for the network")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh did not start")
	}
	for i := 0; i < 20; i++ {
		data, _, ok := proxyMapTile(url)
		if !ok || string(data) != "old" {
			t.Fatal("stored tile was not retained during refresh")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("duplicate refresh requests", calls.Load())
	}
	close(release)
	waitTileRefresh(t)
	data, mime, ok := proxyMapTile(url)
	if !ok || string(data) != "new" || mime != "image/png" {
		t.Fatal("refreshed tile not stored", string(data), mime)
	}
	if calls.Load() != 1 {
		t.Fatal("fresh cache made another request")
	}
}

func TestFailedRefreshRetainsTileAndWaitsBeforeRetry(t *testing.T) {
	var calls atomic.Int32
	setupTileCacheTest(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return tileTestResponse(503), nil
	})
	url := "https://tile.waymarkedtrails.org/cycling/13/3/4.png"
	seedExpiredTile(t, url)
	proxyMapTile(url)
	waitTileRefresh(t)
	for i := 0; i < 20; i++ {
		data, mime, ok := proxyMapTile(url)
		if !ok || string(data) != "old" || mime != "image/webp" {
			t.Fatal("failed refresh lost the cache")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("failed refresh was retried without a pause")
	}
	_, _, stamp, _ := readCachedTile(url)
	if tileCacheFresh(stamp) {
		t.Fatal("failed refresh changed the cache age")
	}
}

func TestClearCacheDoesNotRestoreInFlightRefresh(t *testing.T) {
	started, release := make(chan struct{}, 1), make(chan struct{})
	setupTileCacheTest(t, func(*http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-release
		return tileTestResponse(200), nil
	})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	url := "https://tile.waymarkedtrails.org/cycling/13/5/6.png"
	seedExpiredTile(t, url)
	proxyMapTile(url)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh did not start")
	}
	if err := clearTileCache(); err != nil {
		t.Fatal(err)
	}
	close(release)
	waitTileRefresh(t)
	_, _, _, cached := readCachedTile(url)
	if cached {
		t.Fatal("cache clear was undone by an old request")
	}
}
