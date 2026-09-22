interface Env {
	DB: D1Database;
	INGEST_API_KEY: string;
}

interface ReadingInput {
	device_id?: string;
	measured_at?: number;

	temperature_c: number;
	humidity_pct: number;
	pressure_hpa: number;

	uv_raw?: number | null;
	uv_index?: number | null;

	wind_speed_mps?: number | null;
	wind_gust_mps?: number | null;
	wind_direction_deg?: number | null;

	battery_v?: number | null;
	solar_v?: number | null;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Health check
		if (request.method === "GET" && url.pathname === "/health") {
			return json({
				ok: true,
				service: "weather-station-api",
				time: Math.floor(Date.now() / 1000),
			});
		}

		// ESP32 uploads a reading here
		if (
			request.method === "POST" &&
			url.pathname === "/api/readings"
		) {
			const auth = request.headers.get("Authorization");

			if (auth !== `Bearer ${env.INGEST_API_KEY}`) {
				return json(
					{
						ok: false,
						error: "Unauthorized",
					},
					401,
				);
			}

			let body: ReadingInput;

			try {
				body = await request.json() as ReadingInput;
			} catch {
				return json(
					{
						ok: false,
						error: "Invalid JSON",
					},
					400,
				);
			}

			if (
				typeof body.temperature_c !== "number" ||
				typeof body.humidity_pct !== "number" ||
				typeof body.pressure_hpa !== "number"
			) {
				return json(
					{
						ok: false,
						error: "Missing required sensor values",
					},
					400,
				);
			}

			const measuredAt =
				body.measured_at ?? Math.floor(Date.now() / 1000);

			const deviceId =
				body.device_id?.trim() || "weather-station-01";

			const result = await env.DB
				.prepare(`
					INSERT INTO readings (
						device_id,
						measured_at,
						temperature_c,
						humidity_pct,
						pressure_hpa,
						uv_raw,
						uv_index,
						wind_speed_mps,
						wind_gust_mps,
						wind_direction_deg,
						battery_v,
						solar_v
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`)
				.bind(
					deviceId,
					measuredAt,
					body.temperature_c,
					body.humidity_pct,
					body.pressure_hpa,
					body.uv_raw ?? null,
					body.uv_index ?? null,
					body.wind_speed_mps ?? null,
					body.wind_gust_mps ?? null,
					body.wind_direction_deg ?? null,
					body.battery_v ?? null,
					body.solar_v ?? null,
				)
				.run();

			return json(
				{
					ok: true,
					id: result.meta.last_row_id,
					measured_at: measuredAt,
				},
				201,
			);
		}

		// Get newest reading
		if (
			request.method === "GET" &&
			url.pathname === "/api/readings/latest"
		) {
			const reading = await env.DB
				.prepare(`
					SELECT *
					FROM readings
					ORDER BY measured_at DESC
					LIMIT 1
				`)
				.first();

			return json({
				ok: true,
				reading,
			});
		}

		// Get historical readings
		if (
			request.method === "GET" &&
			url.pathname === "/api/readings"
		) {
			let limit = Number(url.searchParams.get("limit") ?? "100");

			if (!Number.isInteger(limit)) {
				limit = 100;
			}

			limit = Math.max(1, Math.min(limit, 1000));

			const { results } = await env.DB
				.prepare(`
					SELECT *
					FROM readings
					ORDER BY measured_at DESC
					LIMIT ?
				`)
				.bind(limit)
				.all();

			return json({
				ok: true,
				count: results.length,
				readings: results,
			});
		}

		return json(
			{
				ok: false,
				error: "Not found",
			},
			404,
		);
	},
} satisfies ExportedHandler<Env>;
