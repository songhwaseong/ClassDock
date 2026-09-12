$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFile('D:\my\ClassDock.exe')
$launcher = $assembly.GetType('ClassDockLauncher')
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$method = $launcher.GetMethod('TryJejuBus', $flags)
function Read-JejuSample([string]$kind, [string]$value) {
    $parameters = [object[]]@($kind, $value, $false, $null, [datetime]::MinValue, $false, 0)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $ok = $method.Invoke($null, $parameters)
    if (-not $ok) { throw ('Jeju launcher request failed: ' + $kind + ', retry ' + $parameters[6]) }
    [pscustomobject]@{kind=$kind;json=[Text.Encoding]::UTF8.GetString($parameters[3]);at=$parameters[4].ToString('o');stale=$parameters[5];ms=$watch.ElapsedMilliseconds}
}
$routes = Read-JejuSample 'routes' '201'
$routeRows = ($routes.json | ConvertFrom-Json)
$id = [string]$routeRows[0].routeId
$detail = Read-JejuSample 'route' $id
$shape = Read-JejuSample 'shape' $id
$first = Read-JejuSample 'position' $id
$second = Read-JejuSample 'position' $id
if ($first.at -ne $second.at -or $first.json -ne $second.json) { throw 'Cache did not preserve the upstream timestamp and bytes' }
$valid = $launcher.GetMethod('ValidJejuBusValue', $flags)
foreach ($bad in @('https://example.com', '../secret', '1&lineId=2', '1234567890123')) {
    if ($valid.Invoke($null,[object[]]@('position',$bad))) { throw 'Invalid route accepted' }
}
$first.json | Set-Content -LiteralPath 'D:\my\.tmp\jeju-bus-launcher-positions.json' -Encoding UTF8
$report = [pscustomobject]@{exe='D:\my\ClassDock.exe';routeId=$id;routes=$routeRows.Count;stops=@(($detail.json | ConvertFrom-Json).stationInfoList).Count;shapePoints=($shape.json | ConvertFrom-Json).Count;vehicles=($first.json | ConvertFrom-Json).Count;firstAt=$first.at;cachedAt=$second.at;cachePreserved=$true;firstRequestMs=$first.ms;cachedRequestMs=$second.ms;invalidInputRejected=$true}
$report | ConvertTo-Json | Tee-Object -FilePath 'D:\my\.tmp\jeju-bus-launcher-smoke.json'

