/**
 * Mock weather data generator for the OpenAgentPay demo.
 *
 * Uses deterministic pseudo-random values based on the city name,
 * so the same city always returns the same weather. This makes
 * the demo predictable and easy to reason about.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  wind_speed: number;
  timestamp: string;
}

export interface ForecastDay {
  date: string;
  high: number;
  low: number;
  condition: string;
  precipitation_chance: number;
}

export interface ForecastData {
  city: string;
  days: ForecastDay[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Deterministic hash
// ---------------------------------------------------------------------------

/**
 * Simple string hash that produces a number between 0 and 1.
 * Same input always yields the same output — no randomness.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  // Normalize to 0..1 range
  return Math.abs(hash % 10000) / 10000;
}

/**
 * Seeded pseudo-random number generator.
 * Given a seed string, returns a function that produces
 * deterministic "random" numbers in [0, 1).
 */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = (state << 5) - state + seed.charCodeAt(i);
    state |= 0;
  }
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return Math.abs(state) / 2147483647;
  };
}

// ---------------------------------------------------------------------------
// Weather conditions
// ---------------------------------------------------------------------------

const CONDITIONS = [
  "sunny",
  "partly cloudy",
  "cloudy",
  "overcast",
  "light rain",
  "rain",
  "thunderstorm",
  "snow",
  "foggy",
  "windy",
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns mock weather data for a given city.
 *
 * The same city name always produces the same temperature, condition,
 * humidity, and wind speed — making demo output reproducible.
 *
 * @example
 * ```ts
 * const weather = getWeather("London");
 * // { city: "London", temperature: 14, condition: "cloudy", ... }
 * ```
 */
export function getWeather(city: string): WeatherData {
  const normalized = city.toLowerCase().trim();
  const rand = seededRandom(normalized);

  const temperature = Math.round(rand() * 45 - 10); // -10 to 35 C
  const conditionIndex = Math.floor(rand() * CONDITIONS.length);
  const humidity = Math.round(rand() * 60 + 30); // 30-90%
  const windSpeed = Math.round(rand() * 50 * 10) / 10; // 0-50 km/h

  return {
    city,
    temperature,
    condition: CONDITIONS[conditionIndex],
    humidity,
    wind_speed: windSpeed,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns a multi-day forecast for a given city.
 *
 * Each day's weather is deterministically derived from the city name
 * and the day offset, so results are reproducible.
 *
 * @param city - City name
 * @param days - Number of forecast days (1-14)
 *
 * @example
 * ```ts
 * const forecast = getForecast("Tokyo", 5);
 * // { city: "Tokyo", days: [ { date: "2026-03-16", high: 18, ... }, ... ] }
 * ```
 */
export function getForecast(city: string, days: number): ForecastData {
  const clampedDays = Math.max(1, Math.min(days, 14));
  const normalized = city.toLowerCase().trim();
  const today = new Date();

  const forecastDays: ForecastDay[] = [];

  for (let i = 0; i < clampedDays; i++) {
    const daySeed = `${normalized}:day${i}`;
    const rand = seededRandom(daySeed);

    const baseTemp = rand() * 45 - 10;
    const high = Math.round(baseTemp + rand() * 5);
    const low = Math.round(baseTemp - rand() * 8);
    const conditionIndex = Math.floor(rand() * CONDITIONS.length);
    const precipChance = Math.round(rand() * 100);

    const date = new Date(today);
    date.setDate(date.getDate() + i + 1);

    forecastDays.push({
      date: date.toISOString().split("T")[0],
      high,
      low,
      condition: CONDITIONS[conditionIndex],
      precipitation_chance: precipChance,
    });
  }

  return {
    city,
    days: forecastDays,
    generated_at: new Date().toISOString(),
  };
}
