# =============================================================================
# serve.ps1 — minimal static file server for local previewing
#
# Neither Node nor Python is installed on this machine, so this uses the .NET
# HttpListener that ships with Windows. No dependencies, nothing to install.
#
#   Run:   powershell -ExecutionPolicy Bypass -File dev\serve.ps1
#   Open:  http://localhost:8123/
#   Stop:  Ctrl+C
# =============================================================================

param(
    [int]$Port = 8123
)

$root = Split-Path -Parent $PSScriptRoot
$prefix = "http://localhost:$Port/"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.avif' = 'image/avif'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Could not bind $prefix - is something already using port $Port?" -ForegroundColor Red
    exit 1
}

Write-Host "Serving $root" -ForegroundColor Green
Write-Host "  -> $prefix" -ForegroundColor Green
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }

    # One request must never be able to take the server down with it.
    #
    # A browser routinely abandons requests - it navigates away mid-download,
    # or opens a speculative connection and drops it. Writing to that closed
    # socket throws. Without this guard the exception escaped the loop, the
    # listener stopped answering, and the site appeared to hang while the
    # process was still running. Everything below therefore runs inside
    # try/finally, and the response is closed no matter what happened.
    #
    # Keep-alive is switched off for the same reason: a reused connection is
    # one more thing that can be left half-open by a client that has gone.
    # This is a single-user development server, so there is nothing to gain
    # from reusing connections anyway.
    $context.Response.KeepAlive = $false

    try {

    $rel = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    $path = Join-Path $root $rel

    # Directory request -> its index.html
    if ((Test-Path $path -PathType Container)) {
        $path = Join-Path $path 'index.html'
    }

    # Keep every request inside the project folder.
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) {
        $context.Response.StatusCode = 403
        $full = $null
    }

    if ($null -ne $full) {

    # SPA fallback: a path with no file extension is a client-side route
    # (/category/women, /cart, ...), so hand back index.html and let the
    # router work out what to render. Without this, refreshing or opening
    # a deep link directly would 404.
    #
    # There are two shells, so there are two fallbacks. Anything under
    # /admin belongs to the admin panel and must be handed admin/index.html;
    # sending it the storefront shell would load the shop's route table,
    # which has never heard of /admin/products and would render the shop's
    # 404 page instead of the panel.
    if (-not (Test-Path $full -PathType Leaf)) {
        if ([string]::IsNullOrEmpty([System.IO.Path]::GetExtension($full))) {
            if ($rel -eq 'admin' -or $rel -like 'admin/*') {
                $full = Join-Path $root 'admin\index.html'
            } else {
                $full = Join-Path $root 'index.html'
            }
        }
    }

    if (Test-Path $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }

        $context.Response.ContentType = $type
        $context.Response.AddHeader('Cache-Control', 'no-cache, no-store')
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $context.Response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel")
        $context.Response.ContentType = 'text/plain; charset=utf-8'
        $context.Response.OutputStream.Write($msg, 0, $msg.Length)
    }

    }   # end: path was inside the project folder

    } catch {
        # Almost always the client hanging up mid-response. Worth a line so
        # a real fault is still visible, but never worth stopping for.
        Write-Host "  request failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    } finally {
        try { $context.Response.Close() } catch { }
    }
}

$listener.Stop()
