Add-Type -AssemblyName System.Web.Extensions
$parser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$parser.MaxJsonLength=5242880
try {
    $data=$parser.DeserializeObject([IO.File]::ReadAllText('D:\my\.tmp\jeju-bus-check-20260912\route.json'))
    $data.GetType().FullName
    $data['stationInfoList'].GetType().FullName
} catch { $_.Exception.ToString() }
