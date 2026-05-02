$json = Get-Content .\realitydb_output_1775364979840.json | ConvertFrom-Json
$restIds = $json.tables.restaurants.data | ForEach-Object { $_.id }
$menuRefIds = $json.tables.menus.data | ForEach-Object { $_.restaurant_id }
$valid = 0
foreach ($ref in $menuRefIds) {
    if ($restIds -contains $ref) { $valid++ }
}
Write-Host "Restaurant IDs: $($restIds.Count)"
Write-Host "Menu FK refs: $($menuRefIds.Count)"
Write-Host "Valid FK refs: $valid / $($menuRefIds.Count)"
