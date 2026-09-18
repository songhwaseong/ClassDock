"use strict";

/* 한국 평면 좌표계(TM·UTM-K 등) ↔ WGS84 위경도 변환(MNKoreaCoords).
 *
 * 공공데이터 표에는 위경도 대신 평면 좌표(미터)가 흔하다 — 도로명주소·국가공간정보는 UTM-K,
 * 지방행정 인허가(LOCALDATA)는 중부원점 TM(Bessel), 국토부·지자체 공간정보는 GRS80 중부원점.
 * 지도 표 들이기가 이런 줄을 '좌표 오류' 로 버리지 않고 표시로 바꿀 수 있게 한다.
 *
 * 카카오 좌표 변환 API 를 쓰지 않은 까닭: UTM-K(EPSG:5179)를 받지 않는다(2026-09-18 실제 키로 400).
 * 가장 흔한 좌표계를 못 쓰는 셈이라 공식을 직접 넣었다. 키·인터넷·호출 한도가 필요 없고
 * 브라우저(오프라인 HTML)에서도 돈다. 결과는 카카오 변환값과 대조해 테스트로 붙들어 둔다
 * (tests/korea-coords.test.js).
 *
 * 투영: 횡메르카토르, 크뤼거 급수 4차(중앙 경선에서 수 도 안쪽이면 mm 단위로 맞는다).
 * 옛 Bessel 좌표계는 한국측지계 1985 → WGS84 7변수 변환(위치 벡터 방식, proj4 towgs84 와 같은 값)을 거친다.
 * DOM 을 쓰지 않는 순수 모듈이다.
 */

const MNKoreaCoords = (function(){
  const GRS80 = { a:6378137, f:1 / 298.257222101 };
  const WGS84 = { a:6378137, f:1 / 298.257223563 };
  const BESSEL = { a:6377397.155, f:1 / 299.1528128 };
  // 한국측지계 1985 → WGS84 (EPSG:5174·2097 의 towgs84). 이동(m)·회전(초)·축척(ppm).
  const KOREA1985_TO_WGS84 = [-115.80, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43];

  /* id 는 화면·저장에 쓰는 이름. hint 는 사람이 자기 자료가 어느 쪽인지 알아보게 돕는 말. */
  const SYSTEMS = [
    { id:"5179", label:"UTM-K (EPSG:5179)", hint:"도로명주소·국가공간정보", ellipsoid:GRS80, lat0:38, lon0:127.5, k0:0.9996, fe:1000000, fn:2000000 },
    { id:"5186", label:"중부원점 GRS80 (EPSG:5186)", hint:"국토부·지자체 공간정보(가산 60만)", ellipsoid:GRS80, lat0:38, lon0:127, k0:1, fe:200000, fn:600000 },
    { id:"5181", label:"중부원점 GRS80 (EPSG:5181)", hint:"카카오·다음 지도(가산 50만)", ellipsoid:GRS80, lat0:38, lon0:127, k0:1, fe:200000, fn:500000 },
    { id:"2097", label:"중부원점 Bessel (EPSG:2097)", hint:"지방행정 인허가(LOCALDATA) 자료", ellipsoid:BESSEL, lat0:38, lon0:127, k0:1, fe:200000, fn:500000, datum:KOREA1985_TO_WGS84 },
    { id:"5174", label:"보정 중부원점 Bessel (EPSG:5174)", hint:"옛 지적·도시계획 자료", ellipsoid:BESSEL, lat0:38, lon0:127.0028902777778, k0:1, fe:200000, fn:500000, datum:KOREA1985_TO_WGS84 },
    { id:"5185", label:"서부원점 GRS80 (EPSG:5185)", hint:"서해안 지역(가산 60만)", ellipsoid:GRS80, lat0:38, lon0:125, k0:1, fe:200000, fn:600000 },
    { id:"5187", label:"동부원점 GRS80 (EPSG:5187)", hint:"동해안 지역(가산 60만)", ellipsoid:GRS80, lat0:38, lon0:129, k0:1, fe:200000, fn:600000 },
    { id:"5188", label:"동해원점 GRS80 (EPSG:5188)", hint:"울릉도·독도(가산 60만)", ellipsoid:GRS80, lat0:38, lon0:131, k0:1, fe:200000, fn:600000 },
    { id:"32652", label:"UTM 52N (EPSG:32652)", hint:"GPS·해외 지도 프로그램", ellipsoid:WGS84, lat0:0, lon0:129, k0:0.9996, fe:500000, fn:0 },
    // 카카오맵 주소창·공유 링크의 좌표. 5181 값에 2.5 를 곱한 것이다(2026-09-18 카카오 변환으로 확인).
    { id:"wcongnamul", label:"카카오맵 좌표 (WCONGNAMUL)", hint:"카카오맵 링크·주소창", ellipsoid:GRS80, lat0:38, lon0:127, k0:1, fe:200000, fn:500000, scale:2.5 }
  ];
  const byId = new Map(SYSTEMS.map(system => [system.id, system]));
  function system(id){ return byId.get(String(id)) || null; }

  const rad = Math.PI / 180;

  /* 크뤼거 급수 계수(타원체마다 한 번). */
  const seriesCache = new Map();
  function series(ellipsoid){
    let found = seriesCache.get(ellipsoid);
    if (found) return found;
    const n = ellipsoid.f / (2 - ellipsoid.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
    found = {
      n,
      A: ellipsoid.a / (1 + n) * (1 + n2 / 4 + n4 / 64),
      alpha: [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180,
        13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440,
        61 * n3 / 240 - 103 * n4 / 140,
        49561 * n4 / 161280],
      beta: [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360,
        n2 / 48 + n3 / 15 - 437 * n4 / 1440,
        17 * n3 / 480 - 37 * n4 / 840,
        4397 * n4 / 161280],
      delta: [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45,
        7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45,
        56 * n3 / 15 - 136 * n4 / 35,
        4279 * n4 / 630]
    };
    seriesCache.set(ellipsoid, found);
    return found;
  }

  /* 경위도(그 타원체) → 원점 기준 (ξ, η) 무차원 값. */
  function forwardRaw(s, ellipsoid, lat, dLon){
    const e = Math.sqrt(ellipsoid.f * (2 - ellipsoid.f));
    const sinPhi = Math.sin(lat * rad);
    const t = Math.sinh(Math.atanh(sinPhi) - e * Math.atanh(e * sinPhi));
    const lam = dLon * rad;
    const xi0 = Math.atan2(t, Math.cos(lam));
    const eta0 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let xi = xi0, eta = eta0;
    for (let j = 1; j <= 4; j++){
      xi += s.alpha[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
      eta += s.alpha[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
    }
    return [xi, eta];
  }
  function northingOrigin(spec){
    const s = series(spec.ellipsoid);
    return spec.k0 * s.A * forwardRaw(s, spec.ellipsoid, spec.lat0, 0)[0];
  }

  /* 평면 → 그 타원체의 경위도. */
  function inverseTm(spec, x, y){
    const s = series(spec.ellipsoid);
    const xi = (y - spec.fn + northingOrigin(spec)) / (spec.k0 * s.A);
    const eta = (x - spec.fe) / (spec.k0 * s.A);
    let xi1 = xi, eta1 = eta;
    for (let j = 1; j <= 4; j++){
      xi1 -= s.beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      eta1 -= s.beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += s.delta[j - 1] * Math.sin(2 * j * chi);
    const lon = spec.lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1)) / rad;
    return [phi / rad, lon];
  }
  function forwardTm(spec, lat, lon){
    const s = series(spec.ellipsoid);
    const [xi, eta] = forwardRaw(s, spec.ellipsoid, lat, lon - spec.lon0);
    return [spec.fe + spec.k0 * s.A * eta, spec.fn + spec.k0 * s.A * xi - northingOrigin(spec)];
  }

  /* 측지계 바꾸기: 경위도 → 지구 중심 직교좌표 → 7변수(위치 벡터) → 경위도. */
  function toCartesian(ellipsoid, lat, lon){
    const e2 = ellipsoid.f * (2 - ellipsoid.f);
    const sinPhi = Math.sin(lat * rad), cosPhi = Math.cos(lat * rad);
    const N = ellipsoid.a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    return [N * cosPhi * Math.cos(lon * rad), N * cosPhi * Math.sin(lon * rad), N * (1 - e2) * sinPhi];
  }
  function fromCartesian(ellipsoid, X, Y, Z){
    const e2 = ellipsoid.f * (2 - ellipsoid.f);
    const p = Math.hypot(X, Y);
    let phi = Math.atan2(Z, p * (1 - e2));
    for (let i = 0; i < 6; i++){
      const sinPhi = Math.sin(phi);
      const N = ellipsoid.a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
      phi = Math.atan2(Z + e2 * N * sinPhi, p);
    }
    return [phi / rad, Math.atan2(Y, X) / rad];
  }
  function helmert(point, params, inverse){
    const sec = Math.PI / 648000;
    const sign = inverse ? -1 : 1;
    const [tx, ty, tz] = params.slice(0, 3).map(v => v * sign);
    const rx = params[3] * sec * sign, ry = params[4] * sec * sign, rz = params[5] * sec * sign;
    const m = 1 + params[6] * 1e-6 * sign;
    const [X, Y, Z] = point;
    return [tx + m * (X - rz * Y + ry * Z), ty + m * (rz * X + Y - rx * Z), tz + m * (-ry * X + rx * Y + Z)];
  }

  /* 평면 좌표 → WGS84 [위도, 경도]. 쓸 수 없는 값이면 null. */
  function toWgs84(id, x, y){
    const spec = system(id);
    const X = Number(x), Y = Number(y);
    if (!spec || !Number.isFinite(X) || !Number.isFinite(Y)) return null;
    const scale = spec.scale || 1;
    let [lat, lon] = inverseTm(spec, X / scale, Y / scale);
    if (spec.datum){
      const moved = helmert(toCartesian(spec.ellipsoid, lat, lon), spec.datum, false);
      [lat, lon] = fromCartesian(WGS84, moved[0], moved[1], moved[2]);
    }
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? [lat, lon] : null;
  }
  /* WGS84 → 평면 좌표 [x, y]. 테스트와 되돌려 보기용. */
  function fromWgs84(id, lat, lon){
    const spec = system(id);
    if (!spec) return null;
    let phi = Number(lat), lam = Number(lon);
    if (spec.datum){
      const moved = helmert(toCartesian(WGS84, phi, lam), spec.datum, true);
      [phi, lam] = fromCartesian(spec.ellipsoid, moved[0], moved[1], moved[2]);
    }
    const [x, y] = forwardTm(spec, phi, lam);
    const scale = spec.scale || 1;
    return [x * scale, y * scale];
  }

  /* 대한민국 언저리(독도·마라도 포함)인가. 좌표계를 잘못 골랐는지 가늠할 때 쓴다. */
  function inKorea(point){
    return !!point && point[0] >= 32.8 && point[0] <= 38.9 && point[1] >= 124 && point[1] <= 132.2;
  }

  /* 평면 좌표로 보이는가 — 위경도 범위를 크게 벗어난 수. */
  function looksProjected(x, y){
    const X = Number(x), Y = Number(y);
    return Number.isFinite(X) && Number.isFinite(Y) && (Math.abs(X) > 1000 || Math.abs(Y) > 1000);
  }

  /* 값 범위와 열 이름으로 좌표계를 짐작한다. 돌려주는 것: 후보 id 목록(앞이 가장 그럴듯함)과
     x·y 를 서로 바꿔 읽어야 하는지(swap). 중부원점 계열(5186·5181·2097·5174)은 값만으로 가를 수
     없어서 — 5186 과 5181 은 북쪽으로 100km 차이뿐이다 — 화면이 주소 열과 대조하거나 사람에게 묻는다. */
  function guess(points, headers){
    const sample = (Array.isArray(points) ? points : []).filter(p => p && looksProjected(p[0], p[1])).slice(0, 50);
    const text = (Array.isArray(headers) ? headers : []).join(" ").toLowerCase();
    if (!sample.length) return { candidates:[], swap:false };
    const median = (values) => { const list = values.slice().sort((a, b) => a - b); return list[Math.floor(list.length / 2)]; };
    const score = (id, swap) => sample.filter(p => inKorea(toWgs84(id, swap ? p[1] : p[0], swap ? p[0] : p[1]))).length;
    const mx = median(sample.map(p => Number(p[0]))), my = median(sample.map(p => Number(p[1])));
    const central = /좌표정보/.test(text) ? ["2097", "5174", "5181", "5186"] : ["5186", "5181", "2097", "5174"];
    const order = [];
    const push = (ids) => ids.forEach(id => { if (!order.includes(id)) order.push(id); });
    if (Math.max(mx, my) > 3000000) push(["32652"]);
    if (Math.max(mx, my) > 1300000 && Math.max(mx, my) <= 2300000) push(["5179", "wcongnamul"]);
    push(central);
    push(["5185", "5187", "5188", "5179", "32652", "wcongnamul"]);
    // 어느 쪽이 x 인지는 한국 안에 떨어지는 줄 수로 가른다(열 이름을 거꾸로 붙인 표가 있다).
    let best = { id:order[0], swap:false, hits:-1 };
    for (const id of order){
      for (const swap of [false, true]){
        const hits = score(id, swap);
        if (hits > best.hits){ best = { id, swap, hits }; }
      }
    }
    const candidates = order.filter(id => score(id, best.swap) > 0);
    // 가장 그럴듯한 것을 맨 앞에 — 같은 수로 들어맞으면 위에서 정한 차례(열 이름·값 범위)를 따른다.
    candidates.sort((a, b) => score(b, best.swap) - score(a, best.swap) || order.indexOf(a) - order.indexOf(b));
    return { candidates, swap:best.swap };
  }

  return { SYSTEMS, system, toWgs84, fromWgs84, inKorea, looksProjected, guess };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNKoreaCoords;
