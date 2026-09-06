# =============================================================================
# serve.ps1 -- minimal static file server for local previewing
#
# Neither Node nor Python is installed on this machine, so this uses the .NET
# HttpListener that ships with Windows. No dependencies, nothing to install.
#
#   Run:   powershell -ExecutionPolicy Bypass -File dev\serve.ps1
#   Open:  http://localhost:8123/
#   Stop:  Ctrl+C, or close this window
#
# -----------------------------------------------------------------------------
# WHY EACH REQUEST IS HANDLED OFF THE ACCEPT LOOP
#
# The obvious shape for this script is a loop that calls GetContext(), serves
# the file, and loops again. That serves exactly one request at a time, and it
# was enough while a page pulled a handful of files.
#
# The admin panel loads around twenty-five stylesheets and scripts, and a
# browser asks for them over several connections at once. One request that
# stalls -- a client that navigates away mid-download, a socket the browser
# abandons -- then blocks every other request behind it. The process stays
# alive and the port stays open, so nothing looks wrong; the site simply stops
# answering. That happened three times while building the panel.
#
# So the loop now does nothing but accept. Each request is handed to a runspace
# pool and served there, and a stalled one can only ever hold up itself.
# =============================================================================

param(
    [int]$Port = 8123,
    [int]$Workers = 8
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
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
}

# -----------------------------------------------------------------------------
# The handler. Runs in a worker runspace, so everything it needs is passed in;
# it can see nothing from the script's own scope.
# -----------------------------------------------------------------------------

$handler = {
    param($context, $root, $mime)

    try {
        $rel = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

        $path = Join-Path $root $rel

        # Directory request -> its index.html
        if (Test-Path $path -PathType Container) {
            $path = Join-Path $path 'index.html'
        }

        # Keep every request inside the project folder.
        $full = [System.IO.Path]::GetFullPath($path)
        $rootFull = [System.IO.Path]::GetFullPath($root)

        if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            $context.Response.StatusCode = 403
        }
        else {
            # SPA fallback: a path with no file extension is a client-side route
            # (/category/women, /cart, ...), so hand back the shell and let the
            # router work out what to render. Without this, refreshing or
            # opening a deep link directly would 404.
            #
            # There are two shells, so there are two fallbacks. Anything under
            # /admin belongs to the admin panel and must be handed
            # admin/index.html; the storefront shell would load the shop's route
            # table, which has never heard of /admin/products.
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
            }
            else {
                $context.Response.StatusCode = 404
                $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel")
                $context.Response.ContentType = 'text/plain; charset=utf-8'
                $context.Response.ContentLength64 = $msg.Length
                $context.Response.OutputStream.Write($msg, 0, $msg.Length)
            }
        }
    }
    catch {
        # Almost always the client hanging up mid-response. One request must
        # never be able to take the server down with it.
    }
    finally {
        try { $context.Response.Close() } catch { }
    }
}

# -----------------------------------------------------------------------------
# Start
# -----------------------------------------------------------------------------

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Could not bind $prefix - is something already using port $Port?" -ForegroundColor Red
    exit 1
}

$pool = [runspacefactory]::CreateRunspacePool(1, $Workers)
$pool.Open()

Write-Host "Serving $root" -ForegroundColor Green
Write-Host "  -> $prefix" -ForegroundColor Green
Write-Host "  $Workers workers. Ctrl+C to stop." -ForegroundColor DarkGray

# Handles still running. Cleared as they finish, so the list cannot grow
# without bound over a long session.
$running = New-Object System.Collections.ArrayList

try {
    while ($listener.IsListening) {

        try {
            $context = $listener.GetContext()
        } catch {
            break
        }

        $worker = [powershell]::Create()
        $worker.RunspacePool = $pool
        [void]$worker.AddScript($handler).AddArgument($context).AddArgument($root).AddArgument($mime)

        [void]$running.Add(@{
            Worker = $worker
            Handle = $worker.BeginInvoke()
        })

        # Reap whatever has finished since the last request.
        for ($i = $running.Count - 1; $i -ge 0; $i--) {
            if ($running[$i].Handle.IsCompleted) {
                try { [void]$running[$i].Worker.EndInvoke($running[$i].Handle) } catch { }
                $running[$i].Worker.Dispose()
                $running.RemoveAt($i)
            }
        }
    }
}
finally {
    foreach ($item in $running) {
        try { $item.Worker.Dispose() } catch { }
    }
    $pool.Close()
    $pool.Dispose()
    $listener.Stop()
}
