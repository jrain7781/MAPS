
import http.server
import socketserver

PORT = 8000
Handler = http.server.SimpleHTTPRequestHandler

class MyHandler(Handler):
    def end_headers(self):
        self.send_header('Content-type', 'text/html; charset=utf-8')
        super().end_headers()

try:
    with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
        print(f"Serving at http://127.0.0.1:{PORT}")
        httpd.serve_forever()
except OSError as e:
    print(f"Could not start server on port {PORT}. Error: {e}")
    print("The port might be in use by another application.")

