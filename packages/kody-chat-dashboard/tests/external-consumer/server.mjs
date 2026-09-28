import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const root = join(process.cwd(), "public");
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
};

createServer((request, response) => {
  if (request.url === "/api/private") {
    response.statusCode = 401;
    response.setHeader("content-type", "text/plain");
    response.end("Unauthorized server action");
    return;
  }
  const pathname = request.url === "/" ? "/index.html" : request.url;
  const file = join(root, pathname ?? "/index.html");
  response.setHeader(
    "content-type",
    contentTypes[extname(file)] ?? "application/octet-stream",
  );
  createReadStream(file)
    .on("error", () => {
      response.statusCode = 404;
      response.end("Not found");
    })
    .pipe(response);
}).listen(4178, "127.0.0.1", () => {
  process.stdout.write("ready\n");
});
