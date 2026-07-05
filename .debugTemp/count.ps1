$files = @(
    'ts/sync/exceltobangumi.ts',
    'ts/ui/preview.ts',
    'ts/taskpane.ts',
    'ts/services/ribbonService.ts',
    'ts/tools/wps.ts',
    'ts/sync/syncRecord.ts',
    'ts/ui/handlers.ts',
    'ts/core/constants.ts',
    'ts/tools/util.ts',
    'ts/ribbon.ts',
    'ts/sync/pureUtils.ts',
    'ts/tools/stringUtils.ts',
    'ts/tools/events.ts',
    'ts/core/result.ts',
    'ts/ui/dialog.ts',
    'ts/core/crypto.ts',
    'ts/index.ts',
    'ts/tools/config.ts',
    'ts/tools/autoFillUrl.ts',
    'ts/tools/http.ts',
    'ts/sync/scraping.ts',
    'ts/ui/message.ts'
)
$root = 'd:\编程\Excel加载项\BGM\BGM'
$results = foreach ($f in $files) {
    $p = Join-Path $root $f
    $n = (Get-Content $p | Measure-Object -Line).Lines
    [PSCustomObject]@{Lines=$n; File=$f}
}
$results | Sort-Object Lines -Descending | Format-Table -AutoSize
