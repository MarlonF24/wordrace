/** Report process readiness for container health checks. */
export function GET(): Response {
    return Response.json({ status: "ok" });
}
