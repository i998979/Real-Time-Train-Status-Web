const REDIRECT_URI = "https://real-time-train-status-web.pages.dev/auth/callback";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).split("=").join("").split("+").join("-").split("/").join("_");
}

function randomToken(size = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    return base64url(bytes);
}

function cookie(request, name) {
    const value = request.headers.get("Cookie") || "";
    const match = value.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return match ? match[1] : null;
}

function cookieHeader(name, value, maxAge) {
    return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearOAuthCookies() {
    return [
        cookieHeader("oauth_state", "", 0),
        cookieHeader("oauth_verifier", "", 0),
        cookieHeader("oauth_return", "", 0)
    ];
}

async function signingKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function createSession(user, secret) {
    const payload = base64url(new TextEncoder().encode(JSON.stringify({
        sub: user.sub,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE
    })));
    const key = await signingKey(secret);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    return payload + "." + base64url(new Uint8Array(signature));
}

async function validSession(request, secret) {
    try {
        const token = cookie(request, "site_session");
        if (!token || !secret) return false;

        const [payload, signature] = token.split(".");
        if (!payload || !signature) return false;

        const binary = atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4));
        const signatureBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const key = await signingKey(secret);

        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            new TextEncoder().encode(payload)
        );
        if (!valid) return false;

        const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4));
        const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0))));
        return Boolean(session.sub && session.exp > Date.now() / 1000);
    } catch {
        return false;
    }
}

function redirect(location, cookies = []) {
    const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 302, headers });
}

function responseWithClearedCookies(message, status) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const value of clearOAuthCookies()) {
        headers.append("Set-Cookie", value);
    }
    return new Response(message, { status, headers });
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
        return new Response("Authentication is not configured.", { status: 500 });
    }

    if (path === "/auth/google") {
        let returnTo = "/";
        try {
            const target = new URL(
                url.searchParams.get("return_to") || "/",
                url.origin
            );
            if (target.origin === url.origin) {
                returnTo = target.pathname + target.search;
            }
        } catch {}

        const state = randomToken();
        const verifier = randomToken(48);
        const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        const challenge = base64url(new Uint8Array(challengeBytes));

        const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        googleUrl.search = new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: "openid email profile",
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            prompt: "select_account"
        }).toString();

        return redirect(googleUrl.toString(), [
            cookieHeader("oauth_state", state, 600),
            cookieHeader("oauth_verifier", verifier, 600),
            cookieHeader("oauth_return", encodeURIComponent(returnTo), 600)
        ]);
    }

    if (path === "/auth/callback") {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const savedState = cookie(request, "oauth_state");
        const verifier = cookie(request, "oauth_verifier");

        let originalUrl = "/";
        try {
            const saved = cookie(request, "oauth_return");
            const target = new URL(
                decodeURIComponent(saved || "%2F"),
                url.origin
            );
            if (target.origin === url.origin) {
                originalUrl = target.pathname + target.search;
            }
        } catch {}

        const original = new URL(originalUrl, url.origin);
        const cf = request.cf || {};
        const userAgent = request.headers.get("User-Agent") || "";
        const ua = userAgent.toLowerCase();

        const requestInfo = {
            ip: request.headers.get("CF-Connecting-IP"),
            user_agent: userAgent,
            browser: /edg\//.test(ua) ? "Edge" : /opr\//.test(ua) || /opera/.test(ua) ? "Opera" : /firefox\//.test(ua) ? "Firefox" : /chrome\//.test(ua) ? "Chrome" : /safari\//.test(ua) ? "Safari" : "Unknown",
            os: /windows/.test(ua) ? "Windows" : /android/.test(ua) ? "Android" : /iphone|ipad|ipod/.test(ua) ? "iOS" : /mac os/.test(ua) ? "macOS" : /linux/.test(ua) ? "Linux" : "Unknown",
            device_type: /ipad|tablet/.test(ua) ? "Tablet" : /mobile|iphone|ipod|android/.test(ua) ? "Mobile" : "Desktop",
            country: cf.country || request.headers.get("CF-IPCountry"),
            continent: cf.continent,
            city: cf.city,
            region: cf.region,
            region_code: cf.regionCode,
            postal_code: cf.postalCode,
            latitude: cf.latitude,
            longitude: cf.longitude,
            timezone: cf.timezone,
            is_eu_country: cf.isEUCountry,
            asn: cf.asn,
            as_organization: cf.asOrganization,
            colo: cf.colo,
            cf_ray: request.headers.get("CF-Ray"),
            accept_language: request.headers.get("Accept-Language"),
            referer: request.headers.get("Referer"),
            origin: request.headers.get("Origin"),
            http_protocol: cf.httpProtocol,
            tls_version: cf.tlsVersion,
            client_tcp_rtt: cf.clientTcpRtt,
            request_method: request.method,
            request_path: path
        };

        const loggedAt = new Date().toISOString();

        const saveAudit = async (status, user = null, failureReason = null) => {
            const event = {
                event: "google_login",
                status,
                email: user?.email || null,
                google_sub: user?.sub || null,
                name: user?.name || null,
                picture: user?.picture || null,
                email_verified: user?.email_verified ?? null,
                failure_reason: failureReason,
                logged_at: loggedAt,
                ...requestInfo,
                original_url: originalUrl,
                original_path: original.pathname,
                query_parameters: Array.from(original.searchParams.entries())
            };

            const logMethod = status === "success" ? console.log : console.warn;
            logMethod("Google login:", event);

            if (!env.LOGIN_DB) {
                console.warn("LOGIN_DB binding is not configured; login audit event was not saved.");
                return;
            }

            try {
                const columns = [
                    "event_type", "status", "email", "google_sub", "name", "picture",
                    "email_verified", "logged_at", "ip", "user_agent", "browser", "os",
                    "device_type", "country", "continent", "city", "region", "region_code",
                    "postal_code", "latitude", "longitude", "timezone", "is_eu_country",
                    "asn", "as_organization", "colo", "cf_ray", "accept_language", "referer",
                    "origin", "http_protocol", "tls_version", "client_tcp_rtt", "request_method",
                    "request_path", "failure_reason", "metadata_json"
                ];

                const values = [
                    "google_login", status, user?.email || null, user?.sub || null,
                    user?.name || null, user?.picture || null,
                    user?.email_verified == null ? null : (user.email_verified ? 1 : 0),
                    loggedAt, requestInfo.ip, requestInfo.user_agent, requestInfo.browser,
                    requestInfo.os, requestInfo.device_type, requestInfo.country,
                    requestInfo.continent ?? null, requestInfo.city ?? null, requestInfo.region ?? null,
                    requestInfo.region_code ?? null, requestInfo.postal_code ?? null,
                    requestInfo.latitude ?? null, requestInfo.longitude ?? null,
                    requestInfo.timezone ?? null,
                    requestInfo.is_eu_country == null ? null : (requestInfo.is_eu_country ? 1 : 0),
                    requestInfo.asn ?? null, requestInfo.as_organization ?? null,
                    requestInfo.colo ?? null, requestInfo.cf_ray, requestInfo.accept_language,
                    requestInfo.referer, requestInfo.origin, requestInfo.http_protocol ?? null,
                    requestInfo.tls_version ?? null, requestInfo.client_tcp_rtt ?? null,
                    requestInfo.request_method, requestInfo.request_path, failureReason,
                    JSON.stringify(event)
                ];

                await env.LOGIN_DB.prepare(
                    `INSERT INTO login_events (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
                ).bind(...values).run();
            } catch (error) {
                console.error("Failed to save login audit event to D1:", error);
            }
        };

        if (!code || !state || !savedState || state !== savedState || !verifier) {
            await saveAudit("failed", null, "Invalid or missing OAuth state, code, or verifier");
            return responseWithClearedCookies(
                "Invalid login response. Please try again.",
                400
            );
        }

        let user = null;
        let failureReason = "Authentication failed";

        try {
            const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    code,
                    client_id: env.GOOGLE_CLIENT_ID,
                    client_secret: env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                    grant_type: "authorization_code",
                    code_verifier: verifier
                })
            });

            if (!tokenResponse.ok) {
                failureReason = "Google token exchange rejected the request";
                throw new Error(failureReason);
            }

            const tokens = await tokenResponse.json();

            const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
                headers: { Authorization: "Bearer " + tokens.access_token }
            });

            if (!userResponse.ok) {
                failureReason = "Google userinfo request failed";
                throw new Error(failureReason);
            }

            user = await userResponse.json();

            if (!user.sub || !user.email || user.email_verified !== true) {
                failureReason = "Google account identity or verified email is missing";
                throw new Error(failureReason);
            }

            const session = await createSession(user, env.SESSION_SECRET);
            await saveAudit("success", user);

            return redirect(originalUrl, [
                cookieHeader("site_session", session, SESSION_MAX_AGE),
                ...clearOAuthCookies()
            ]);
        } catch {
            await saveAudit("failed", user, failureReason);
            return responseWithClearedCookies(
                "Google login failed. Please try again.",
                401
            );
        }
    }

    if (path === "/auth/logout") {
        return redirect("/", [cookieHeader("site_session", "", 0)]);
    }

    if (path === "/" || path === "/index.html") {
        if (!(await validSession(request, env.SESSION_SECRET))) {
            return redirect(
                `/auth/google?return_to=${encodeURIComponent(url.pathname + url.search)}`
            );
        }
    }

    return context.next();
}
