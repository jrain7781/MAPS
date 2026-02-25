$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""
$env:NO_PROXY = "*"
$Root = "C:\LJW\MAPS_TEST"
$Clasprc = Join-Path $Root ".clasprc.json"
Set-Location $Root
$env:CLASPRC = $Clasprc
$env:USERPROFILE = $Root
$env:HOME = $Root
clasp push
exit $LASTEXITCODE
