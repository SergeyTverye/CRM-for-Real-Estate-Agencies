import { aiCredentialsService } from "@/modules/ai/application/credentials-service";
import { SOURCES } from "../domain/types";
import { searchSettings } from "./dependencies";
import { bootstrapAiTariffs, missingTariffMessage, searchTariffsReady } from "@/modules/ai/application/tariff-bootstrap";
import { effectiveAiSettings } from "@/modules/ai/application/settings-service";

export type AvailabilityReason = "disabled_by_server" | "disabled_by_settings" | "ready" | "credential_store_unavailable" | "credentials_missing" | "tariff_unavailable";
type FeatureReadyReason = "disabled_by_server" | "disabled_by_settings" | "ready";
export function featureReason(ceiling: boolean, requested: boolean): FeatureReadyReason {
  return !ceiling ? "disabled_by_server" : !requested ? "disabled_by_settings" : "ready";
}

export async function searchAvailability() {
  const s = await searchSettings();
  const credentials = await aiCredentialsService(s.config).resolve();
  const aiReason = featureReason(s.config.AI_ENABLED, !!s.settings?.aiEnabled);
  let reason: AvailabilityReason = aiReason !== "ready" ? aiReason : credentials.unavailable ? "credential_store_unavailable" : !credentials.credentials ? "credentials_missing" : "ready";
  if (reason === "ready" && s.settings) {
    if (s.config.CRM_DEPLOYMENT_MODE === "desktop" && !s.config.isReadOnlyInstance) await bootstrapAiTariffs();
    const { values } = effectiveAiSettings(s.settings, s.config);
    if (!await searchTariffsReady(values.model, values.webModel)) reason = "tariff_unavailable";
  }
  return {
    scraper: { enabled: s.enabled, reason: featureReason(s.config.SCRAPER_ENABLED, !!s.settings?.scraperEnabled) },
    browser: { enabled: s.config.SCRAPER_BROWSER_ENABLED && !!s.settings?.browserEnabled, configured: !!s.config.SCRAPER_CHROME_PATH || !!process.env.SCRAPER_BROWSER_EXECUTABLE_PATH },
    sources: SOURCES.map(source => ({ source, enabled: s.enabled && s.sources.includes(source),
      reason: featureReason(s.config.SCRAPER_ENABLED, !!s.settings?.scraperEnabled && s.sources.includes(source)) })),
    ai: { enabled: s.aiEnabled, configured: !!credentials.credentials, available: reason === "ready", reason,
      message: reason === "credentials_missing" ? "Требуется подключение Яндекс AI" : reason === "credential_store_unavailable" ? "Защищённое хранилище Яндекс AI недоступно" : reason === "tariff_unavailable" ? missingTariffMessage : null, settingsUrl: "/settings/ai" },
    manualWeb: s.aiEnabled && s.manualAllowed && reason === "ready", autoFallback: s.aiEnabled && s.autoFallback && s.manualAllowed && reason === "ready",
  };
}
