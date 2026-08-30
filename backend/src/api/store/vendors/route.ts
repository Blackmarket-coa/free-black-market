import { createLogger } from "../../../shared/logger"
import { distanceMiles } from "../../../lib/geo-distance"
const log = createLogger("api/store/vendors")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VendorType } from "../../../modules/seller-extension/models/seller-metadata"
import { VENDOR_VERIFICATION_MODULE } from "../../../modules/vendor-verification"
import type VendorVerificationService from "../../../modules/vendor-verification/service"

/**
 * Archetypes this endpoint fetches through their own dedicated entity query
 * (the `producer`, `kitchen` and `garden` tables), earlier in the handler.
 */
export const DEDICATED_ENTITY_VENDOR_TYPES: string[] = [
  "producer",
  "kitchen",
  "garden",
]

/**
 * Every other archetype, which exists only as a `seller_metadata` row.
 *
 * Derived from `VendorType` so that adding an archetype makes it visible in
 * the public directory automatically. The previous hardcoded list is why
 * `creator` sellers never appeared here.
 */
export const METADATA_BACKED_VENDOR_TYPES: string[] = Object.values(
  VendorType
).filter((type) => !DEDICATED_ENTITY_VENDOR_TYPES.includes(type))

// Distance math consolidated into lib/geo-distance (W5).

/**
 * Approximate US zip code prefix (first 3 digits) to lat/lng center.
 * Covers all 50 states plus DC and territories.
 */
const ZIP_PREFIX_COORDS: Record<string, [number, number]> = {
  // Northeast
  "010": [42.1, -72.6], "011": [42.3, -72.6], "012": [42.5, -73.2], "013": [42.1, -72.6],
  "014": [42.3, -71.8], "015": [42.3, -71.8], "016": [42.3, -71.8], "017": [42.3, -71.8],
  "018": [42.1, -71.0], "019": [42.5, -71.0], "020": [42.4, -71.1], "021": [42.4, -71.1],
  "022": [42.3, -71.1], "023": [42.1, -70.7], "024": [42.4, -71.1], "025": [41.7, -70.3],
  "026": [41.8, -71.1], "027": [41.8, -71.4], "028": [41.8, -71.4], "029": [41.7, -71.5],
  "030": [43.0, -71.5], "031": [42.9, -71.5], "032": [43.2, -71.5], "033": [43.2, -71.5],
  "034": [43.6, -72.3], "035": [44.3, -71.8], "036": [43.6, -72.3], "037": [43.6, -72.3],
  "038": [42.9, -71.3], "039": [43.5, -70.5], "040": [43.7, -70.3], "041": [43.5, -70.5],
  "042": [43.2, -70.9], "043": [44.3, -69.8], "044": [44.8, -68.8], "045": [44.1, -70.2],
  "046": [44.8, -68.8], "047": [46.8, -68.0], "048": [44.8, -68.8], "049": [44.3, -69.0],
  "050": [44.3, -72.6], "051": [44.5, -72.0], "052": [44.5, -72.0], "053": [44.3, -72.6],
  "054": [44.5, -73.2], "056": [44.0, -72.7], "057": [43.6, -72.3], "058": [44.5, -73.2],
  "059": [44.5, -73.2], "060": [41.8, -72.7], "061": [41.8, -73.2], "062": [41.3, -73.0],
  "063": [41.3, -73.0], "064": [41.3, -73.0], "065": [41.3, -73.0], "066": [41.3, -72.9],
  "067": [41.5, -73.0], "068": [41.2, -73.2], "069": [41.2, -73.2],
  // New Jersey
  "070": [40.7, -74.2], "071": [40.7, -74.2], "072": [40.5, -74.4], "073": [40.5, -74.4],
  "074": [41.0, -74.3], "075": [40.9, -74.2], "076": [40.8, -74.1], "077": [40.3, -74.1],
  "078": [40.6, -74.6], "079": [40.9, -74.8], "080": [39.9, -75.0], "081": [39.7, -75.1],
  "082": [39.5, -74.5], "083": [39.5, -74.5], "084": [39.5, -75.3], "085": [40.2, -74.7],
  "086": [40.2, -74.8], "087": [40.4, -74.3], "088": [40.5, -74.3], "089": [40.4, -74.5],
  // New York
  "100": [40.8, -74.0], "101": [40.8, -73.9], "102": [40.8, -73.9], "103": [40.6, -74.1],
  "104": [40.8, -73.9], "105": [41.0, -73.8], "106": [41.0, -73.9], "107": [41.0, -73.9],
  "108": [40.9, -73.8], "109": [41.3, -74.0], "110": [40.8, -73.7], "111": [40.7, -73.8],
  "112": [40.7, -74.0], "113": [40.7, -73.9], "114": [40.7, -73.8], "115": [40.8, -73.7],
  "116": [40.7, -73.8], "117": [40.7, -73.4], "118": [40.7, -73.4], "119": [40.8, -73.0],
  "120": [42.7, -73.7], "121": [42.7, -73.7], "122": [42.7, -73.7], "123": [42.4, -73.8],
  "124": [41.7, -73.9], "125": [41.5, -74.0], "126": [41.9, -74.0], "127": [41.5, -74.4],
  "128": [42.5, -75.5], "129": [42.1, -75.9], "130": [43.1, -76.2], "131": [43.1, -76.2],
  "132": [43.1, -75.2], "133": [42.1, -76.8], "134": [43.0, -76.2], "135": [43.1, -75.2],
  "136": [43.9, -75.9], "137": [42.4, -76.5], "138": [42.4, -76.5], "139": [42.1, -79.2],
  "140": [42.9, -78.9], "141": [42.9, -78.9], "142": [42.9, -78.9], "143": [42.1, -77.1],
  "144": [43.2, -77.6], "145": [43.2, -77.6], "146": [43.2, -77.6], "147": [42.1, -76.8],
  "148": [42.4, -76.5], "149": [44.7, -73.5],
  // Pennsylvania
  "150": [40.4, -80.0], "151": [40.4, -80.0], "152": [40.4, -80.0], "153": [40.5, -79.0],
  "154": [41.2, -79.4], "155": [40.3, -78.9], "156": [40.5, -79.9], "157": [40.2, -79.5],
  "158": [41.9, -80.1], "159": [40.3, -78.9], "160": [41.2, -79.4], "161": [41.4, -78.6],
  "162": [41.9, -79.5], "163": [42.1, -80.1], "164": [41.9, -79.5], "165": [42.1, -80.1],
  "166": [40.5, -78.4], "167": [40.3, -78.9], "168": [40.5, -78.4], "169": [41.4, -78.6],
  "170": [40.3, -76.9], "171": [40.3, -76.9], "172": [40.0, -76.3], "173": [40.0, -76.3],
  "174": [40.3, -76.9], "175": [40.3, -76.9], "176": [40.3, -76.0], "177": [40.0, -77.5],
  "178": [40.6, -75.5], "179": [40.6, -75.5], "180": [40.6, -75.5], "181": [40.6, -75.5],
  "182": [41.2, -75.9], "183": [40.3, -76.0], "184": [41.4, -75.7], "185": [41.2, -75.9],
  "186": [41.2, -75.9], "187": [41.4, -75.7], "188": [41.2, -75.9], "189": [40.1, -75.4],
  "190": [40.0, -75.1], "191": [40.0, -75.2], "192": [40.0, -75.2], "193": [39.9, -75.8],
  "194": [40.1, -75.4], "195": [40.3, -75.1], "196": [39.9, -75.8], "197": [39.7, -75.5],
  "198": [39.7, -75.5], "199": [39.7, -75.5],
  // DC, Maryland, Virginia
  "200": [38.9, -77.0], "201": [38.9, -77.0], "202": [38.9, -77.0], "203": [38.9, -77.0],
  "204": [38.9, -77.0], "205": [38.9, -77.0], "206": [38.9, -76.6], "207": [38.8, -76.7],
  "208": [39.1, -77.0], "209": [39.3, -76.6], "210": [39.3, -76.6], "211": [39.3, -76.6],
  "212": [39.3, -76.6], "214": [38.9, -76.5], "215": [39.6, -77.7], "216": [38.3, -76.5],
  "217": [39.6, -77.7], "218": [38.3, -75.6], "219": [39.6, -79.0],
  "220": [38.8, -77.1], "221": [38.8, -77.1], "222": [38.8, -77.2], "223": [38.8, -77.4],
  "224": [37.6, -77.5], "225": [37.3, -79.4], "226": [38.3, -78.5], "227": [37.6, -77.5],
  "228": [37.3, -79.4], "229": [37.3, -79.4], "230": [37.5, -77.4], "231": [36.8, -76.3],
  "232": [37.5, -77.4], "233": [36.8, -76.3], "234": [36.8, -76.3], "235": [37.0, -76.3],
  "236": [36.8, -76.3], "237": [37.0, -76.3], "238": [37.5, -77.4], "239": [37.0, -76.3],
  "240": [37.3, -79.9], "241": [37.3, -79.9], "242": [36.6, -82.2], "243": [37.3, -80.1],
  "244": [37.3, -79.4], "245": [37.8, -79.4], "246": [36.6, -82.2],
  // West Virginia
  "247": [37.8, -81.2], "248": [37.8, -81.2], "249": [37.8, -81.2],
  "250": [38.3, -81.6], "251": [38.3, -81.6], "252": [38.3, -81.6], "253": [38.3, -81.6],
  "254": [38.1, -80.8], "255": [38.4, -82.4], "256": [38.4, -82.4], "257": [38.0, -80.0],
  "258": [37.8, -81.2], "259": [39.0, -79.5], "260": [39.6, -80.0], "261": [39.3, -80.3],
  "262": [39.5, -79.8], "263": [39.3, -80.3], "264": [39.5, -80.1], "265": [39.0, -79.5],
  "266": [39.3, -80.3], "267": [39.5, -79.5], "268": [39.5, -79.5],
  // North Carolina, South Carolina
  "270": [36.1, -80.2], "271": [36.1, -80.2], "272": [35.8, -78.6], "273": [35.8, -78.6],
  "274": [36.1, -80.2], "275": [35.8, -78.6], "276": [36.1, -80.2], "277": [35.2, -80.8],
  "278": [35.2, -80.8], "279": [35.2, -80.8], "280": [35.2, -80.8], "281": [35.2, -80.8],
  "282": [35.2, -80.8], "283": [35.6, -82.6], "284": [35.6, -82.6], "285": [35.1, -79.0],
  "286": [35.5, -77.4], "287": [35.5, -77.4], "288": [34.2, -77.9], "289": [34.0, -81.0],
  "290": [34.0, -81.0], "291": [34.0, -81.0], "292": [34.0, -81.0], "293": [34.8, -82.4],
  "294": [32.8, -79.9], "295": [33.4, -82.0], "296": [34.0, -80.0], "297": [34.0, -81.0],
  "298": [34.2, -79.8], "299": [32.9, -80.0],
  // Georgia
  "300": [33.7, -84.4], "301": [33.7, -84.4], "302": [33.7, -84.4], "303": [33.7, -84.4],
  "304": [33.5, -84.8], "305": [34.2, -84.2], "306": [33.5, -84.2], "307": [34.8, -85.0],
  "308": [33.5, -82.0], "309": [33.5, -82.0], "310": [33.5, -82.0], "311": [32.1, -81.1],
  "312": [32.1, -81.1], "313": [31.6, -84.2], "314": [31.6, -84.2], "315": [32.5, -83.6],
  "316": [31.2, -82.4], "317": [31.2, -82.4], "318": [31.6, -84.2], "319": [31.6, -84.2],
  // Florida
  "320": [30.3, -81.7], "321": [28.5, -81.4], "322": [30.3, -81.7], "323": [28.5, -81.4],
  "324": [29.7, -82.3], "325": [30.4, -84.3], "326": [29.2, -82.1], "327": [28.5, -81.4],
  "328": [28.5, -81.4], "329": [28.5, -81.4], "330": [25.8, -80.2], "331": [25.8, -80.2],
  "332": [25.8, -80.2], "333": [26.1, -80.1], "334": [26.7, -80.1], "335": [27.9, -82.5],
  "336": [27.9, -82.5], "337": [27.9, -82.5], "338": [28.1, -80.6], "339": [26.1, -80.1],
  "340": [18.2, -66.5], "341": [26.1, -80.1], "342": [27.9, -82.5],
  "344": [29.2, -82.1], "346": [27.9, -82.5], "347": [28.5, -81.4],
  // Alabama, Tennessee, Mississippi
  "350": [33.5, -86.8], "351": [33.5, -86.8], "352": [33.5, -86.8],
  "354": [33.2, -87.6], "355": [33.5, -86.8], "356": [34.7, -87.7],
  "357": [34.7, -86.6], "358": [34.7, -86.6], "359": [33.5, -86.8],
  "360": [32.4, -86.3], "361": [32.4, -86.3], "362": [32.4, -85.0],
  "363": [31.2, -85.4], "364": [32.3, -86.3], "365": [30.7, -88.1],
  "366": [30.7, -88.1], "367": [32.4, -86.3], "368": [33.2, -87.6],
  "369": [33.5, -86.8],
  "370": [36.2, -86.8], "371": [36.2, -86.8], "372": [36.2, -86.8],
  "373": [35.0, -85.3], "374": [35.0, -85.3], "375": [35.1, -90.0],
  "376": [36.3, -82.4], "377": [35.9, -83.9], "378": [35.9, -83.9],
  "379": [35.9, -83.9], "380": [35.1, -90.0], "381": [35.1, -90.0],
  "382": [35.1, -90.0], "383": [35.6, -88.8], "384": [35.6, -88.8],
  "385": [35.8, -86.4], "386": [34.3, -88.7],
  "387": [33.4, -88.8], "388": [34.3, -89.5], "389": [33.4, -88.8],
  "390": [32.3, -90.2], "391": [32.3, -90.2], "392": [32.3, -90.2],
  "393": [31.3, -89.3], "394": [34.3, -88.7], "395": [30.4, -89.1],
  "396": [33.5, -90.2], "397": [32.3, -90.2],
  // Kentucky, Ohio
  "400": [38.3, -85.8], "401": [38.3, -85.8], "402": [38.3, -85.8],
  "403": [38.0, -84.5], "404": [38.0, -84.5], "405": [38.0, -84.5],
  "406": [38.0, -84.5], "410": [41.1, -81.5], "411": [41.1, -81.5],
  "420": [37.0, -86.4], "421": [37.0, -86.4], "422": [37.0, -85.3],
  "423": [37.8, -82.5], "424": [37.8, -82.5], "425": [38.0, -84.5],
  "426": [38.0, -84.5], "427": [37.0, -86.4],
  "430": [40.0, -82.9], "431": [40.0, -82.9], "432": [40.0, -82.9],
  "433": [40.8, -81.4], "434": [41.1, -81.5], "435": [41.5, -81.7],
  "436": [41.7, -83.7], "437": [41.1, -80.7], "438": [41.1, -80.7],
  "439": [41.5, -81.7], "440": [41.5, -81.7], "441": [41.5, -81.7],
  "442": [41.1, -81.5], "443": [41.1, -81.5], "444": [41.1, -81.5],
  "445": [39.1, -84.5], "446": [40.8, -81.4], "447": [39.8, -84.2],
  "448": [39.8, -84.2], "449": [39.8, -84.2], "450": [39.1, -84.5],
  "451": [39.1, -84.5], "452": [39.1, -84.5], "453": [39.8, -84.2],
  "454": [39.8, -84.2], "455": [39.8, -84.2], "456": [39.3, -82.1],
  "457": [39.3, -82.1], "458": [39.3, -84.5],
  // Indiana, Michigan
  "460": [39.8, -86.1], "461": [39.8, -86.1], "462": [39.8, -86.1],
  "463": [39.8, -86.1], "464": [39.8, -86.1], "465": [39.8, -86.1],
  "466": [40.4, -86.9], "467": [41.1, -85.1], "468": [41.7, -86.3],
  "469": [41.7, -86.3], "470": [39.1, -84.5], "471": [39.1, -84.5],
  "472": [39.2, -85.9], "473": [38.3, -85.8], "474": [39.2, -86.5],
  "475": [39.5, -87.4], "476": [38.0, -87.6], "477": [38.0, -87.6],
  "478": [39.5, -87.4], "479": [40.4, -86.9],
  "480": [42.3, -83.0], "481": [42.3, -83.0], "482": [42.3, -83.0],
  "483": [42.3, -83.0], "484": [42.7, -83.3], "485": [42.7, -83.3],
  "486": [43.0, -83.7], "487": [43.4, -84.0], "488": [42.7, -84.5],
  "489": [42.3, -85.2], "490": [42.3, -85.6], "491": [43.0, -85.7],
  "492": [42.3, -85.6], "493": [43.2, -86.2], "494": [44.8, -84.7],
  "495": [42.9, -85.0], "496": [44.3, -85.6], "497": [44.8, -84.7],
  "498": [46.5, -87.4], "499": [46.5, -87.4],
  // Iowa, Wisconsin, Minnesota
  "500": [41.6, -93.6], "501": [41.6, -93.6], "502": [41.6, -93.6],
  "503": [41.6, -93.6], "504": [42.5, -96.4], "505": [42.0, -94.4],
  "506": [42.5, -92.3], "507": [42.5, -92.3], "508": [42.5, -90.7],
  "509": [41.0, -91.7], "510": [41.3, -95.9], "511": [41.3, -95.9],
  "512": [41.0, -91.7], "513": [41.0, -92.4], "514": [40.8, -91.1],
  "515": [41.0, -93.5], "516": [41.6, -93.6],
  "520": [42.9, -88.0], "521": [42.9, -88.0], "530": [43.1, -89.4],
  "531": [43.1, -89.4], "532": [43.0, -87.9], "534": [43.8, -89.7],
  "535": [43.1, -89.4], "537": [43.1, -89.4], "538": [43.1, -89.4],
  "539": [43.1, -89.4], "540": [44.5, -88.0], "541": [44.5, -88.0],
  "542": [44.5, -88.0], "543": [44.5, -88.0], "544": [45.8, -89.7],
  "545": [44.8, -91.5], "546": [43.8, -91.2], "547": [44.8, -91.5],
  "548": [44.8, -89.6], "549": [44.5, -88.0],
  "550": [44.9, -93.3], "551": [44.9, -93.3], "553": [44.9, -93.3],
  "554": [44.9, -93.3], "555": [44.9, -93.3], "556": [46.8, -92.1],
  "557": [46.8, -92.1], "558": [46.8, -92.1], "559": [44.0, -92.5],
  "560": [43.5, -96.7], "561": [43.5, -96.7], "562": [44.4, -98.2],
  "563": [44.4, -98.2], "564": [44.4, -100.4], "565": [44.4, -100.4],
  "566": [46.9, -96.8], "567": [46.9, -96.8],
  "570": [43.5, -96.7], "571": [43.5, -96.7], "572": [43.5, -98.4],
  "573": [43.5, -98.4], "574": [44.4, -98.2], "575": [44.4, -100.4],
  "576": [44.4, -103.2], "577": [44.4, -103.2],
  "580": [46.9, -96.8], "581": [46.9, -96.8], "582": [47.9, -97.0],
  "583": [47.9, -97.0], "584": [46.9, -96.8], "585": [46.9, -96.8],
  "586": [48.2, -101.3], "587": [48.2, -101.3], "588": [48.2, -103.6],
  // Montana
  "590": [45.8, -108.5], "591": [45.8, -108.5], "592": [47.5, -111.0],
  "593": [47.5, -111.0], "594": [47.5, -111.0], "595": [46.9, -114.0],
  "596": [47.5, -111.0], "597": [46.9, -114.0], "598": [47.5, -111.0],
  "599": [47.5, -111.0],
  // Illinois
  "600": [41.9, -87.6], "601": [41.9, -87.6], "602": [41.9, -87.6],
  "603": [41.9, -87.6], "604": [41.9, -87.6], "605": [41.9, -87.6],
  "606": [41.9, -87.6], "607": [41.9, -87.6], "608": [41.5, -88.1],
  "609": [41.5, -89.1], "610": [41.5, -90.6], "611": [41.5, -90.6],
  "612": [41.5, -90.6], "613": [40.7, -89.6], "614": [40.7, -89.6],
  "615": [40.7, -89.6], "616": [40.7, -89.6], "617": [40.5, -88.1],
  "618": [40.1, -88.2], "619": [40.1, -88.2], "620": [39.8, -89.6],
  "622": [38.6, -90.2], "623": [38.6, -90.2], "624": [37.7, -89.2],
  "625": [39.8, -89.6], "626": [39.8, -89.6], "627": [39.8, -89.6],
  "628": [38.5, -89.0], "629": [37.7, -89.2],
  // Missouri, Kansas
  "630": [38.6, -90.2], "631": [38.6, -90.2], "633": [38.6, -90.2],
  "634": [38.6, -90.2], "635": [38.6, -90.2], "636": [38.6, -90.2],
  "637": [38.6, -90.2], "638": [38.6, -90.2], "639": [38.6, -90.2],
  "640": [39.1, -94.6], "641": [39.1, -94.6], "644": [37.2, -93.3],
  "645": [37.2, -93.3], "646": [39.1, -94.6], "647": [39.1, -94.6],
  "648": [39.1, -94.6], "649": [39.1, -94.6], "650": [38.6, -92.2],
  "651": [38.6, -92.2], "652": [38.6, -92.2], "653": [38.6, -90.2],
  "654": [37.2, -93.3], "655": [37.2, -93.3], "656": [37.2, -93.3],
  "657": [37.2, -93.3], "658": [39.1, -94.6],
  "660": [39.1, -94.6], "661": [39.1, -94.6], "662": [39.1, -94.6],
  "664": [39.0, -95.7], "665": [39.0, -95.7], "666": [39.0, -95.7],
  "667": [39.0, -95.7], "668": [39.0, -95.7], "669": [38.8, -97.6],
  "670": [37.7, -97.3], "671": [37.7, -97.3], "672": [37.7, -97.3],
  "673": [37.7, -97.3], "674": [38.8, -99.3], "675": [37.8, -100.5],
  "676": [38.9, -99.3], "677": [37.8, -100.5], "678": [37.8, -100.5],
  "679": [37.8, -100.5],
  // Nebraska
  "680": [41.3, -96.0], "681": [41.3, -96.0], "683": [40.8, -96.7],
  "684": [40.8, -96.7], "685": [40.8, -96.7], "686": [41.3, -96.0],
  "687": [41.1, -100.8], "688": [41.1, -100.8], "689": [41.1, -100.8],
  "690": [41.1, -100.8], "691": [41.9, -103.7], "692": [41.1, -100.8],
  "693": [41.1, -100.8],
  // Louisiana, Arkansas
  "700": [30.0, -90.1], "701": [30.0, -90.1], "703": [30.0, -90.1],
  "704": [30.0, -90.1], "705": [30.0, -90.1], "706": [30.2, -93.2],
  "707": [30.5, -91.2], "708": [30.5, -91.2], "710": [32.5, -93.7],
  "711": [32.5, -93.7], "712": [32.5, -91.1], "713": [31.3, -92.5],
  "714": [31.3, -92.5],
  "716": [35.4, -94.0], "717": [34.7, -92.3], "718": [34.7, -92.3],
  "719": [34.7, -92.3], "720": [34.7, -92.3], "721": [34.7, -92.3],
  "722": [34.7, -92.3], "723": [34.7, -92.3], "724": [35.4, -94.0],
  "725": [35.4, -94.0], "726": [35.4, -94.0], "727": [35.4, -94.0],
  "728": [36.4, -94.2], "729": [35.4, -94.0],
  // Oklahoma
  "730": [35.5, -97.5], "731": [35.5, -97.5], "734": [34.2, -97.1],
  "735": [34.6, -98.4], "736": [35.5, -97.5], "737": [35.5, -97.5],
  "738": [35.5, -97.5], "739": [34.6, -98.4], "740": [36.1, -95.9],
  "741": [36.1, -95.9], "743": [36.1, -95.9], "744": [36.7, -97.1],
  "745": [35.0, -95.0], "746": [35.0, -95.0], "747": [34.2, -97.1],
  "748": [34.7, -94.7], "749": [35.0, -95.0],
  // Texas
  "750": [32.8, -96.8], "751": [32.8, -96.8], "752": [32.8, -96.8],
  "753": [32.8, -96.8], "754": [32.8, -96.8], "755": [32.8, -96.8],
  "756": [31.5, -97.1], "757": [31.5, -97.1], "758": [31.5, -97.1],
  "759": [31.5, -97.1], "760": [32.7, -97.3], "761": [32.7, -97.3],
  "762": [32.7, -97.3], "763": [33.4, -97.1], "764": [31.8, -97.4],
  "765": [31.5, -97.1], "766": [33.9, -98.5], "767": [33.9, -98.5],
  "768": [32.4, -99.7], "769": [31.4, -100.5],
  "770": [29.8, -95.4], "771": [29.8, -95.4], "772": [29.8, -95.4],
  "773": [29.8, -95.4], "774": [29.8, -95.4], "775": [29.8, -95.4],
  "776": [30.1, -94.1], "777": [30.1, -94.1], "778": [27.8, -97.4],
  "779": [27.5, -97.5], "780": [29.4, -98.5], "781": [29.4, -98.5],
  "782": [29.4, -98.5], "783": [27.5, -97.5], "784": [27.5, -97.5],
  "785": [26.2, -98.2], "786": [30.3, -97.7], "787": [30.3, -97.7],
  "788": [30.3, -97.7], "789": [30.3, -97.7], "790": [33.6, -101.8],
  "791": [34.2, -101.8], "792": [33.6, -101.8], "793": [33.6, -101.8],
  "794": [31.8, -106.4], "795": [31.8, -106.4], "796": [31.8, -106.4],
  "797": [31.8, -106.4], "798": [31.8, -106.4], "799": [31.8, -106.4],
  // Colorado, Wyoming, Idaho, Utah
  "800": [39.7, -105.0], "801": [39.7, -105.0], "802": [39.7, -105.0],
  "803": [39.7, -105.0], "804": [39.7, -105.0], "805": [39.7, -105.0],
  "806": [39.7, -105.0], "807": [38.8, -104.8], "808": [38.8, -104.8],
  "809": [38.8, -104.8], "810": [38.3, -104.6], "811": [37.3, -108.6],
  "812": [38.5, -107.9], "813": [37.3, -108.6], "814": [40.6, -105.1],
  "815": [40.6, -105.1], "816": [39.1, -108.5],
  "820": [41.1, -104.8], "821": [41.1, -104.8], "822": [42.9, -106.3],
  "823": [42.9, -106.3], "824": [42.9, -106.3], "825": [42.8, -108.7],
  "826": [42.8, -108.7], "827": [44.8, -106.9], "828": [44.8, -110.5],
  "829": [44.3, -105.5], "830": [44.3, -105.5], "831": [44.3, -105.5],
  "832": [43.6, -116.2], "833": [42.6, -114.5], "834": [43.5, -112.0],
  "835": [46.4, -117.0], "836": [43.6, -116.2], "837": [43.6, -116.2],
  "838": [46.4, -117.0],
  "840": [40.8, -111.9], "841": [40.8, -111.9], "842": [40.8, -111.9],
  "843": [40.8, -111.9], "844": [40.2, -111.7], "845": [40.2, -111.7],
  "846": [40.2, -111.7], "847": [38.6, -109.6],
  // Arizona, New Mexico, Nevada
  "850": [33.4, -112.0], "851": [33.4, -112.0], "852": [33.4, -112.0],
  "853": [33.4, -112.0], "855": [33.4, -112.0], "856": [32.2, -110.9],
  "857": [32.2, -110.9], "859": [35.2, -111.6], "860": [35.2, -111.6],
  "863": [33.4, -112.0], "864": [32.2, -110.9], "865": [35.2, -111.6],
  "870": [35.1, -106.6], "871": [35.1, -106.6], "873": [35.1, -106.6],
  "874": [36.7, -105.9], "875": [35.1, -106.6], "877": [34.1, -106.9],
  "878": [34.1, -106.9], "879": [34.1, -106.9], "880": [32.3, -106.8],
  "881": [33.4, -104.5], "882": [32.3, -106.8], "883": [32.3, -106.8],
  "884": [32.3, -106.8],
  "889": [36.2, -115.1], "890": [36.2, -115.1], "891": [36.2, -115.1],
  "893": [39.5, -119.8], "894": [39.5, -119.8], "895": [39.5, -119.8],
  "897": [39.5, -119.8], "898": [40.8, -117.8],
  // California
  "900": [34.1, -118.2], "901": [34.1, -118.2], "902": [34.1, -118.2],
  "903": [34.1, -118.2], "904": [34.1, -118.2], "905": [33.8, -118.2],
  "906": [34.1, -118.2], "907": [34.1, -118.2], "908": [34.1, -118.2],
  "910": [34.0, -118.4], "911": [34.1, -118.1], "912": [34.1, -118.2],
  "913": [34.2, -118.5], "914": [34.2, -118.5], "915": [34.4, -118.5],
  "916": [34.4, -118.5], "917": [34.1, -118.2], "918": [34.1, -118.2],
  "919": [32.7, -117.2], "920": [32.7, -117.2], "921": [32.7, -117.2],
  "922": [33.9, -116.6], "923": [33.8, -117.9], "924": [33.8, -117.9],
  "925": [33.9, -117.4], "926": [33.7, -117.8], "927": [33.7, -117.8],
  "928": [33.9, -117.4], "930": [34.4, -119.7], "931": [34.4, -119.7],
  "932": [34.3, -118.2], "933": [35.4, -119.0], "934": [35.4, -119.0],
  "935": [35.0, -118.5], "936": [36.7, -119.8], "937": [36.7, -119.8],
  "938": [36.7, -119.8], "939": [36.6, -121.9], "940": [37.8, -122.4],
  "941": [37.8, -122.4], "942": [38.6, -121.5], "943": [37.3, -121.9],
  "944": [37.3, -121.9], "945": [37.8, -122.3], "946": [37.8, -122.3],
  "947": [37.9, -122.1], "948": [37.6, -122.4], "949": [37.9, -122.5],
  "950": [37.3, -121.9], "951": [33.9, -117.4], "952": [37.7, -121.9],
  "953": [37.7, -121.9], "954": [37.3, -122.0], "955": [40.6, -122.4],
  "956": [38.6, -121.5], "957": [38.6, -121.5], "958": [38.6, -121.5],
  "959": [39.1, -121.6], "960": [39.1, -121.6], "961": [39.5, -119.8],
  // Hawaii, Oregon, Washington, Alaska
  "967": [21.3, -157.8], "968": [21.3, -157.8],
  "970": [45.5, -122.7], "971": [45.5, -122.7], "972": [45.5, -122.7],
  "973": [44.9, -123.0], "974": [44.1, -121.3], "975": [44.1, -121.3],
  "976": [44.1, -121.3], "977": [42.3, -122.9], "978": [45.7, -121.5],
  "979": [45.7, -121.5],
  "980": [47.6, -122.3], "981": [47.6, -122.3], "982": [47.3, -122.2],
  "983": [47.3, -122.2], "984": [47.3, -122.5], "985": [47.2, -122.4],
  "986": [45.6, -122.7], "988": [47.4, -120.3], "989": [47.7, -117.4],
  "990": [47.7, -117.4], "991": [47.7, -117.4], "992": [47.7, -117.4],
  "993": [46.6, -120.5], "994": [46.2, -119.2],
  "995": [61.2, -149.9], "996": [61.2, -149.9], "997": [64.8, -147.7],
  "998": [58.3, -134.4], "999": [65.0, -150.0],
}

/**
 * Convert a US zip code to approximate lat/lng using prefix lookup.
 */
function zipToCoords(zip: string): { lat: number; lng: number } | null {
  const prefix = zip.substring(0, 3)
  const coords = ZIP_PREFIX_COORDS[prefix]
  if (coords) {
    return { lat: coords[0], lng: coords[1] }
  }
  return null
}

/**
 * GET /store/vendors
 *
 * Unified vendor listing endpoint that aggregates all vendor types
 * into a single customer-facing directory.
 *
 * Query params:
 * - vendor_type: Filter by type (producer, garden, kitchen, maker, restaurant, mutual_aid)
 * - search: Text search on name, description, location
 * - featured: "true" to show only featured vendors
 * - lat: Latitude for distance filtering
 * - lng: Longitude for distance filtering
 * - zip: US zip code for distance filtering (converted to lat/lng)
 * - radius_miles: Max distance in miles (default 50)
 * - has_photo: "true" to show only vendors with a profile picture
 * - sort: "newest" to sort by creation date descending (default: featured first, then name)
 * - limit: Results per page (default 50)
 * - offset: Pagination offset (default 0)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query")

  const {
    vendor_type,
    search,
    featured,
    lat,
    lng,
    zip,
    radius_miles = "50",
    has_photo,
    sort,
    limit = "50",
    offset = "0",
  } = req.query as Record<string, any>

  // Resolve coordinates from zip if lat/lng not provided
  let userLat = lat ? parseFloat(lat) : NaN
  let userLng = lng ? parseFloat(lng) : NaN

  if (isNaN(userLat) && isNaN(userLng) && zip) {
    const coords = zipToCoords(String(zip))
    if (coords) {
      userLat = coords.lat
      userLng = coords.lng
    }
  }

  const hasLocationFilter = !isNaN(userLat) && !isNaN(userLng)
  const maxRadius = parseFloat(radius_miles) || 50

  try {
    const vendors: any[] = []

    // 1. Fetch producers
    if (!vendor_type || vendor_type === "producer") {
      try {
        const producerFilters: Record<string, any> = {
          public_profile_enabled: true,
        }
        if (featured === "true") producerFilters.featured = true

        const { data: producers } = await query.graph({
          entity: "producer",
          fields: [
            "id",
            "seller_id",
            "name",
            "handle",
            "description",
            "region",
            "state",
            "country_code",
            "latitude",
            "longitude",
            "practices",
            "certifications",
            "photo",
            "cover_image",
            "featured",
            "verified",
            "year_established",
            "created_at",
          ],
          filters: producerFilters,
        })

        for (const p of producers || []) {
          if (!p.handle) continue
          vendors.push({
            id: p.id,
            seller_id: p.seller_id,
            name: p.name,
            handle: p.handle,
            description: p.description,
            vendor_type: "producer",
            vendor_type_label: "Grower & Producer",
            photo: p.photo || p.cover_image,
            location: {
              region: p.region,
              state: p.state,
              country_code: p.country_code,
              latitude: p.latitude,
              longitude: p.longitude,
            },
            practices: p.practices,
            certifications: p.certifications,
            featured: p.featured,
            verified: p.verified,
            year_established: p.year_established,
            created_at: p.created_at,
            profile_url: `/producers/${p.handle}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch producers:", err)
      }
    }

    // 2. Fetch kitchens
    if (!vendor_type || vendor_type === "kitchen") {
      try {
        const { data: kitchens } = await query.graph({
          entity: "kitchen",
          fields: [
            "id",
            "name",
            "slug",
            "description",
            "city",
            "state",
            "zip",
            "coordinates",
            "kitchen_type",
            "status",
            "total_stations",
            "total_sqft",
            "hourly_rate",
            "certifications",
            "cover_image_url",
            "created_at",
          ],
          filters: { status: "active" },
        })

        for (const k of kitchens || []) {
          if (!k.slug) continue
          const coords = k.coordinates as any
          vendors.push({
            id: k.id,
            name: k.name,
            handle: k.slug,
            description: k.description,
            vendor_type: "kitchen",
            vendor_type_label: "Shared Kitchen",
            photo: k.cover_image_url,
            location: {
              city: k.city,
              state: k.state,
              zip: k.zip,
              latitude: coords?.lat,
              longitude: coords?.lng,
            },
            kitchen_type: k.kitchen_type,
            total_stations: k.total_stations,
            total_sqft: k.total_sqft,
            hourly_rate: k.hourly_rate,
            certifications: k.certifications,
            featured: false,
            verified: false,
            created_at: k.created_at,
            profile_url: `/kitchens/${k.slug}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch kitchens:", err)
      }
    }

    // 3. Fetch gardens
    if (!vendor_type || vendor_type === "garden") {
      try {
        const { data: gardens } = await query.graph({
          entity: "garden",
          fields: [
            "id",
            "name",
            "slug",
            "description",
            "city",
            "state",
            "zip",
            "coordinates",
            "status",
            "total_plots",
            "total_sqft",
            "cover_image_url",
            "gallery_urls",
            "created_at",
          ],
          filters: { status: "active" } as any,
        })

        for (const g of gardens || []) {
          if (!g.slug) continue
          const coords = g.coordinates as { lat?: number; lng?: number } | null
          const galleryUrls = g.gallery_urls as string[] | null
          vendors.push({
            id: g.id,
            name: g.name,
            handle: g.slug,
            description: g.description,
            vendor_type: "garden",
            vendor_type_label: "Community Growing Space",
            photo: g.cover_image_url || (galleryUrls?.[0] ?? undefined),
            location: {
              city: g.city,
              state: g.state,
              zip: g.zip,
              latitude: coords?.lat,
              longitude: coords?.lng,
            },
            total_plots: g.total_plots,
            total_sqft: g.total_sqft,
            featured: false,
            verified: false,
            created_at: g.created_at,
            profile_url: `/gardens/${g.slug}`,
          })
        }
      } catch (err) {
        log.warn("Could not fetch gardens:", err)
      }
    }

    // 4. Fetch every remaining seller type via seller_metadata.
    //
    // The set is DERIVED (all archetypes minus the three with dedicated entity
    // queries above) rather than enumerated. It used to be the hardcoded list
    // ["maker", "restaurant", "mutual_aid"], which meant any archetype added
    // later was invisible in this endpoint on both paths — `?vendor_type=X`
    // matched no branch and returned nothing, and the unfiltered "all vendors"
    // listing enumerated only those three. `creator` has been missing from the
    // public directory that way since it was introduced.
    if (!vendor_type || METADATA_BACKED_VENDOR_TYPES.includes(vendor_type)) {
      try {
        const metadataFilters: Record<string, any> = {}
        if (vendor_type && METADATA_BACKED_VENDOR_TYPES.includes(vendor_type)) {
          metadataFilters.vendor_type = vendor_type
        } else if (!vendor_type) {
          // Everything not already fetched by the branches above.
          metadataFilters.vendor_type = METADATA_BACKED_VENDOR_TYPES
        }
        if (featured === "true") metadataFilters.featured = true

        const { data: sellerMetadata } = await query.graph({
          entity: "seller_metadata",
          fields: [
            "id",
            "seller_id",
            "vendor_type",
            "featured",
            "verified",
            "rating",
            "social_links",
            "website_url",
            "certifications",
          ],
          filters: metadataFilters,
        })

        const vendorTypeLabels: Record<string, string> = {
          maker: "Maker & Brand",
          restaurant: "Food Business",
          mutual_aid: "Community Organization",
          creator: "Creator",
          general: "Business",
        }

        for (const meta of sellerMetadata || []) {
          if (!meta.seller_id) continue
          try {
            const { data: sellers } = await query.graph({
              entity: "seller",
              fields: ["id", "name", "handle", "description", "photo", "created_at"],
              filters: { id: meta.seller_id },
            })

            const seller = sellers?.[0]
            if (!seller) continue

            if (!seller.handle) {
              // A handle-less seller would produce a dead "/sellers/null"
              // profile link in the directory — skip it and flag the data.
              log.warn(
                `Seller ${seller.id} (${seller.name}) has no handle; excluded from vendor directory`
              )
              continue
            }

            vendors.push({
              // Use the seller id as the canonical vendor id for seller-backed vendor types.
              // This keeps ids consistent with seller data used across storefront/vendor panel APIs.
              id: meta.seller_id,
              metadata_id: meta.id,
              seller_id: meta.seller_id,
              name: seller.name,
              handle: seller.handle,
              description: seller.description,
              vendor_type: meta.vendor_type,
              vendor_type_label:
                vendorTypeLabels[meta.vendor_type] || meta.vendor_type,
              photo: seller.photo,
              location: {},
              featured: meta.featured,
              verified: meta.verified,
              rating: meta.rating,
              website_url: meta.website_url,
              certifications: meta.certifications,
              created_at: seller.created_at,
              profile_url: `/sellers/${seller.handle}`,
            })
          } catch {
            // Skip sellers that can't be fetched
          }
        }
      } catch (err) {
        log.warn("Could not fetch seller metadata:", err)
      }
    }

    // Apply search filter
    let filteredVendors = vendors
    if (search) {
      const searchLower = (search as string).toLowerCase()
      filteredVendors = filteredVendors.filter(
        (v) =>
          v.name?.toLowerCase().includes(searchLower) ||
          v.description?.toLowerCase().includes(searchLower) ||
          v.location?.region?.toLowerCase().includes(searchLower) ||
          v.location?.city?.toLowerCase().includes(searchLower) ||
          v.location?.state?.toLowerCase().includes(searchLower)
      )
    }

    // Apply has_photo filter
    if (has_photo === "true") {
      filteredVendors = filteredVendors.filter((v) => v.photo)
    }

    // Apply distance filter
    if (hasLocationFilter) {
      filteredVendors = filteredVendors
        .map((v) => {
          const vLat = v.location?.latitude
          const vLng = v.location?.longitude
          if (vLat != null && vLng != null) {
            const distance = distanceMiles(userLat, userLng, vLat, vLng)
            return { ...v, distance: Math.round(distance * 10) / 10 }
          }
          return { ...v, distance: null }
        })
        .filter((v) => v.distance !== null && v.distance <= maxRadius)
        .sort((a, b) => (a.distance || 0) - (b.distance || 0))
    } else if (sort === "newest") {
      // Sort by creation date, newest first
      filteredVendors.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA
      })
    } else {
      // Sort by featured first, then name
      filteredVendors.sort((a, b) => {
        if (a.featured && !b.featured) return -1
        if (!a.featured && b.featured) return 1
        return (a.name || "").localeCompare(b.name || "")
      })
    }

    // Apply pagination
    const parsedOffset = parseInt(offset, 10) || 0
    const parsedLimit = parseInt(limit, 10) || 50
    const paginatedVendors = filteredVendors.slice(
      parsedOffset,
      parsedOffset + parsedLimit
    )

    // Attach the real verification level to the page being returned.
    //
    // Every branch above sets a `verified` boolean — from `seller_metadata` in
    // some cases, hardcoded `false` in others — which is a second, weaker
    // source of truth than the five-level `vendor_verification` record. A card
    // reading "Verified" off a metadata flag can disagree with what the seller
    // page shows, so the level is resolved here and takes precedence.
    //
    // Enriched after pagination, in one query for the whole page, so this costs
    // a single extra read rather than one per vendor in the unpaginated set.
    const withVerification = await attachVerificationLevels(
      req,
      paginatedVendors
    )

    res.json({
      vendors: withVerification,
      count: filteredVendors.length,
      limit: parsedLimit,
      offset: parsedOffset,
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch vendors",
      error: error.message,
    })
  }
}

/**
 * Resolve each vendor's verification level from `vendor_verification`.
 *
 * Vendors keyed by `seller_id` where present, falling back to `id` — the
 * archetype branches above build rows from different entities, and only some
 * of them carry an explicit seller id.
 *
 * Failure is non-fatal: the listing is the point of the endpoint, and a
 * verification read that errors should downgrade the badge, not 500 the page.
 */
async function attachVerificationLevels(
  req: MedusaRequest,
  vendors: Array<Record<string, any>>
): Promise<Array<Record<string, any>>> {
  if (vendors.length === 0) return vendors

  try {
    const service = req.scope.resolve<VendorVerificationService>(
      VENDOR_VERIFICATION_MODULE
    )

    const sellerIds = Array.from(
      new Set(
        vendors
          .map((v) => v.seller_id || v.id)
          .filter((id): id is string => typeof id === "string")
      )
    )

    const records = await service.listVendorVerifications({
      seller_id: sellerIds,
    })

    const levelBySeller = new Map(
      records.map((record) => [record.seller_id, record.level])
    )

    return vendors.map((vendor) => {
      const level = levelBySeller.get(vendor.seller_id || vendor.id)
      if (!level) return vendor
      return {
        ...vendor,
        verification_level: level,
        // Only the reviewed levels count as verified to a buyer.
        // SELF_REPORTED means the seller told us, not that we checked.
        verified: ["VERIFIED", "AUDITED", "CERTIFIED"].includes(level),
      }
    })
  } catch (err) {
    log.warn("Could not attach verification levels:", err)

return vendors
  }
}
