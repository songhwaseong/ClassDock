GRIB2 fixture: NOAA GFS, 2026-10-02 00 UTC, forecast +6 h, UGRD 850 mb, 1 degree.

Public source: https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261002/00/atmos/gfs.t00z.pgrb2.1p00.f006

Range 28775590–28828148 (52,559 bytes), identified by the matching `.idx` file.
The hash in `world-wind.cs` was independently obtained with ECMWF ecCodes 2.49.0:
decode values, reshape (181,360), reverse the latitude axis, cast to little-endian float32, SHA-256.
All 65,160 decoded values match byte for byte. No ecCodes dependency is shipped or required by tests.

KMA typhoon fixture (`kma-typhoon-20261002.json`): 기상청_태풍정보 조회서비스 getTyphoonInfo response
(fromTmFc 2026-09-29 … toTmFc 2026-10-02, received 2026-10-02 16:30 KST through the ClassDock launcher).
Public data (공공저작물, 출처: 기상청). Contains no service key.
KMA typhoon forecast fixture (`kma-typhoon-fcst-20261002.json`): getTyphoonFcst for typhoon 27 (CHOI-WAN), bulletin tmFc 202610021600,
received 2026-10-02 through the ClassDock launcher. Public data (공공저작물, 출처: 기상청). Contains no service key.
