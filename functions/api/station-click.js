function getCookie(request, name) {
    const value = request.headers.get("Cookie") || "";
    const match = value.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return match ? match[1] : null;
}

async function getSession(request, secret) {
    try {
        const token = getCookie(request, "site_session");
        if (!token || !secret) return null;

        const [payload, signature] = token.split(".");
        if (!payload || !signature) return null;

        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            {name: "HMAC", hash: "SHA-256"},
            false,
            ["verify"]
        );

        const binary = atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4));
        const signatureBytes = Uint8Array.from(binary, c => c.charCodeAt(0));

        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            new TextEncoder().encode(payload)
        );
        if (!valid) return null;

        const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4));
        const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0))));

        return session.sub && session.email && session.exp > Date.now() / 1000
            ? session
            : null;
    } catch {
        return null;
    }
}

export async function onRequestPost({request, env}) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) {
        return new Response("Forbidden", {status: 403});
    }

    if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
        return new Response("Unsupported Media Type", {status: 415});
    }

    const session = await getSession(request, env.SESSION_SECRET);
    if (!session) {
        return new Response("Unauthorized", {status: 401});
    }

    if (!env.LOGIN_DB) {
        return new Response("Database is not configured", {status: 500});
    }

    try {
        const {station, station_name} = await request.json();

        if (typeof station !== "string" || !/^[A-Z0-9_]{2,10}$/.test(station)) {
            return new Response("Invalid station", {status: 400});
        }

        const name = typeof station_name === "string"
            ? station_name.slice(0, 100)
            : station;

        await env.LOGIN_DB.prepare(
            "INSERT INTO station_click_events (google_sub, email, station, station_name, clicked_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(
            session.sub,
            session.email,
            station,
            name,
            new Date().toISOString()
        ).run();

        return Response.json({success: true}, {
            headers: {"Cache-Control": "no-store"}
        });
    } catch (error) {
        console.error("Failed to save station click:", error);
        return new Response("Bad Request", {status: 400});
    }
}
