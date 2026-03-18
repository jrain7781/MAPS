$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""
$env:NO_PROXY = "*"
$Root = "C:\LJW\MAPS_TEST"
$Clasprc = Join-Path $env:USERPROFILE ".clasprc.json"
Set-Location $Root
# $env:CLASPRC = $Clasprc
# $env:USERPROFILE = $Root
# $env:HOME = $Root
clasp push
if ($LASTEXITCODE -eq 0) {
    clasp deploy -i "AKfycbya2qB-fW1uihP-LVZSDo4DB2AsWrDJRwpT0L3UyTBI_hNcvmp8aUet3SX71hZOh7u5eQ"
}
exit $LASTEXITCODE
