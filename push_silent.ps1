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
    clasp deploy -i "AKfycby1SnLYJmPQ9PU0JlEZC5rG3e9y9s6wMVrsPeG_gqgDBnK9FMkyVPb3v5V0DFI14ETZiA"
}
exit $LASTEXITCODE
