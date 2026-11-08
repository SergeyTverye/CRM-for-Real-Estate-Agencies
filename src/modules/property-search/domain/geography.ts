const novosibirsk = "Дзержинский|Железнодорожный|Заельцовский|Калининский|Кировский|Ленинский|Октябрьский|Первомайский|Советский|Центральный".split("|");
const moscow = ("Академический|Алексеевский|Алтуфьевский|Арбат|Аэропорт|Бабушкинский|Басманный|Беговой|Бескудниковский|Бибирево|Бирюлёво Восточное|Бирюлёво Западное|Богородское|Братеево|Бутырский|Вешняки|Внуково|Войковский|Восточное Дегунино|Восточное Измайлово|Восточный|Выхино-Жулебино|Гагаринский|Головинский|Гольяново|Даниловский|Дмитровский|Донской|Дорогомилово|Замоскворечье|Западное Дегунино|Зюзино|Зябликово|Ивановское|Измайлово|Капотня|Коньково|Коптево|Косино-Ухтомский|Котловка|Красносельский|Крылатское|Крюково|Кузьминки|Кунцево|Куркино|Левобережный|Лефортово|Лианозово|Ломоносовский|Лосиноостровский|Люблино|Марфино|Марьина Роща|Марьино|Матушкино|Метрогородок|Мещанский|Митино|Можайский|Молжаниновский|Москворечье-Сабурово|Нагатино-Садовники|Нагатинский Затон|Нагорный|Некрасовка|Нижегородский|Ново-Переделкино|Новогиреево|Новокосино|Обручевский|Орехово-Борисово Северное|Орехово-Борисово Южное|Останкинский|Отрадное|Очаково-Матвеевское|Перово|Печатники|Покровское-Стрешнево|Преображенское|Пресненский|Проспект Вернадского|Раменки|Ростокино|Рязанский|Савёлки|Савёловский|Свиблово|Северное Бутово|Северное Измайлово|Северное Медведково|Северное Тушино|Северный|Силино|Сокол|Соколиная Гора|Сокольники|Солнцево|Старое Крюково|Строгино|Таганский|Тверской|Текстильщики|Тёплый Стан|Тимирязевский|Тропарёво-Никулино|Филёвский Парк|Фили-Давыдково|Хамовники|Ховрино|Хорошёво-Мнёвники|Хорошёвский|Царицыно|Черёмушки|Чертаново Северное|Чертаново Центральное|Чертаново Южное|Щукино|Южное Бутово|Южное Медведково|Южное Тушино|Южнопортовый|Якиманка|Ярославский|Ясенево").split("|");
export function normalizeGeography(value: string): string { return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/(?:^|\s)(?:г\.|город|район|р-н)(?=\s|$)/gu, " ").replace(/\s+/g, " ").trim(); }
export const DISTRICTS: Readonly<Record<string, readonly string[]>> = { новосибирск: novosibirsk, москва: moscow };
/** Address must explicitly identify a district: no inference from street/metro names or description. */
export function resolveDistrict(city: string | null, district: string | null, address: string | null): string | null {
  const catalog = DISTRICTS[normalizeGeography(city ?? "")];
  if (!catalog) return null;
  if (district) {
    const found = catalog.find(d => normalizeGeography(d) === normalizeGeography(district));
    if (found) return found;
  }
  const text = (address ?? "").toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ");
  const matches = catalog.filter(d => {
    const name = normalizeGeography(d);
    return new RegExp(`(?:^|[,;\\s])(?:(?:район|р-н)\\s+${name}|${name}\\s+(?:район|р-н))(?=$|[,;\\s])`, "u").test(text);
  });
  return matches.length === 1 ? matches[0]! : null;
}


/** Stable location IDs, independent of marketplace namespaces. */
export const SEARCH_LOCATIONS = [
  { id: "novosibirsk", label: "Новосибирск", kind: "city", city: "Новосибирск", slug: "novosibirsk" },
  { id: "suburbs", label: "Новосибирск и пригороды", kind: "group", city: "Новосибирск", slug: "novosibirsk" },
  { id: "akademgorodok", label: "Академгородок (Советский район)", kind: "district", city: "Новосибирск", slug: "novosibirsk" },
  { id: "berdsk", label: "Бердск", kind: "settlement", city: "Бердск", slug: "berdsk" },
  { id: "ob", label: "Обь", kind: "settlement", city: "Обь", slug: "ob" },
  { id: "koltsovo", label: "Кольцово", kind: "settlement", city: "Кольцово", slug: "koltsovo" },
  { id: "krasnoobsk", label: "Краснообск", kind: "settlement", city: "Краснообск", slug: "krasnoobsk" },
  { id: "iskitim", label: "Искитим", kind: "settlement", city: "Искитим", slug: "iskitim" },
  { id: "novosibirsk-region", label: "Новосибирская область целиком", kind: "region", city: "Новосибирская область", slug: "novosibirskaya-oblast" },
] as const;
export type SearchLocationId = typeof SEARCH_LOCATIONS[number]["id"];
export const LOCATION_IDS = SEARCH_LOCATIONS.map(l => l.id) as [SearchLocationId, ...SearchLocationId[]];
export function selectedLocations(filters: { city: string; locations?: SearchLocationId[] }) {
  const selected = filters.locations?.length ? SEARCH_LOCATIONS.filter(l => filters.locations!.includes(l.id)) : SEARCH_LOCATIONS.filter(l => normalizeGeography(l.city) === normalizeGeography(filters.city) && !["group", "district"].includes(l.kind));
  return selected.flatMap(l => l.id === "suburbs" ? SEARCH_LOCATIONS.filter(v => ["novosibirsk", "berdsk", "ob", "koltsovo", "krasnoobsk"].includes(v.id)) : [l]).filter((l, i, all) => all.findIndex(v => v.id === l.id) === i);
}
const token = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, "iu").test(text);
/** Address evidence wins over a parser's broad city label. Streets named after a city are not a locality. */
export function locationState(listing: { city: string | null; address: string | null; district: string | null }, filters: { city: string; locations?: SearchLocationId[] }): "matched" | "contradicted" | "unknown" {
  const address = normalizeGeography(listing.address ?? "").replace(/обл\.(?=\s|,|$)/gu, "область");
  const placeText = address.replace(/(?:река|реки|берег|набережная)\s+обь/gu, "").replace(/(?:улица|ул\.|проспект|пр-т|переулок|шоссе|площадь)\s+[^,;]+/gu, "");
  const addressPlaces = SEARCH_LOCATIONS.filter(l => !["group", "district", "region"].includes(l.kind) && token(placeText, normalizeGeography(l.city)));
  const cityPlaces = SEARCH_LOCATIONS.filter(l => !["group", "district", "region"].includes(l.kind) && normalizeGeography(listing.city ?? "") === normalizeGeography(l.city));
  const specificPlaces = addressPlaces.filter(l => l.kind === "settlement");
  const places = specificPlaces.length ? specificPlaces : addressPlaces.length ? addressPlaces : cityPlaces;
  const choices = selectedLocations(filters);
  if (!choices.length) return listing.city ? normalizeGeography(listing.city) === normalizeGeography(filters.city) ? "matched" : "contradicted" : "unknown";
  const explicitRegion = normalizeGeography([listing.address, listing.city].filter(Boolean).join(", ")).match(/(?<![\p{L}])([\p{L}-]+)\s+(?:область|край)(?![\p{L}])/u);
  if (explicitRegion && explicitRegion[1] !== "новосибирская") return "contradicted";
  const states = choices.map(l => {
    if (l.kind === "region") return token(placeText, "новосибирская область") || token(normalizeGeography(listing.city ?? ""), "новосибирская область") || places.length > 0 ? "matched" : /москва|санкт-петербург/iu.test(listing.city ?? "") ? "contradicted" : "unknown";
    if (l.kind === "district") {
      if (places.length && !places.some(p => p.id === "novosibirsk") || !places.length && listing.city && !/новосибирск/iu.test(listing.city)) return "contradicted";
      if (token(placeText, "академгородок")) return "matched";
      const district = resolveDistrict("Новосибирск", listing.district, listing.address);
      return district ? district === "Советский" ? "matched" : "contradicted" : "unknown";
    }
    if (places.length) return places.some(p => p.id === l.id) ? "matched" : "contradicted";
    return listing.city && !/новосибирская область/iu.test(listing.city) ? "contradicted" : "unknown";
  });
  return states.includes("matched") ? "matched" : states.includes("unknown") ? "unknown" : "contradicted";
}
export function locationSummary(filters: { city: string; locations?: SearchLocationId[] }): string {
  return filters.locations?.length ? SEARCH_LOCATIONS.filter(l => filters.locations!.includes(l.id)).map(l => l.label).join(" или ") : filters.city;
}

/** Only a fresh implicit city is replaced; restored searches keep their explicit selection. */
export function chooseLocations(selected: SearchLocationId[], id: SearchLocationId, implicitDefault: boolean): SearchLocationId[] {
  if (implicitDefault && selected.length === 1 && selected[0] === "novosibirsk" && id !== "novosibirsk") return [id];
  return selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
}
