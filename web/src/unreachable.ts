/**
 * True when the dev-server proxy could not reach the Requester. Vite 5 answers a refused upstream with
 * HTTP 500 and an empty body (node_modules/vite proxy "error" handler), not 502/503/504; a real Requester
 * error carries a JSON body, so a non-empty 500 is shown to the user.
 */
export function isUnreachable(status: number, body: string): boolean {
  return status === 502 || status === 503 || status === 504 || (status === 500 && body.trim() === "")
}
