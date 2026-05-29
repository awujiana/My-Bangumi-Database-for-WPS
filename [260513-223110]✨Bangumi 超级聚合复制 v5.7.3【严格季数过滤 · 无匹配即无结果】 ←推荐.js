// ==UserScript==
// @name         ✨Bangumi 超级聚合复制 v5.7.3【严格季数过滤 · 无匹配即无结果】 2026年05月13日 22:32:24
// @version      5.7.3
// @description  右上角面板，AniDB+MAL+TMDB，Ctrl+Shift+C，仅保留与Bangumi季数一致的译名，无匹配则提示失败
// @author       終焉ノ廻輪
// @include      *://bangumi.tv/subject/*
// @include      *://bgm.tv/subject/*
// @include      *://chii.in/subject/*
// @require      https://cdn.staticfile.org/jquery/2.1.4/jquery.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @connect      anidb.net
// @connect      api.jikan.moe
// @connect      api.themoviedb.org
// @run-at       document-end
// @license      MIT
// @icon         https://lain.bgm.tv/pic/icon/s/000/00/13/1391.jpg?r=1357822756
// @icon64       https://lain.bgm.tv/pic/icon/s/000/00/13/1391.jpg?r=1357822756
// ==/UserScript==

(function ($) {
  'use strict';

  const USE_SECOND_ROW_EN = 0;                // 英文行控制
  const ALLOW_OTHER_LANGS = false;            // 仅中日英
  const TMDB_API_KEY = 'e67c36b6146a318f6cf8c4fd63967f82'; // 请替换
  const PANEL_MAX_HEIGHT = 300;               // 面板最大高度

  let externalLines = [null, null, null], finalText = '', isReady = false;
  const globalTitleCount = new Map();
  const logCache = [];

  /* ---------- 语言判断 ---------- */
  function isJapanese(s) { return (s.match(/[\u3040-\u309F\u30A0-\u30FF]/g)||[]).length > 1; }
  function isEnglish(s)  { return /^[\w\s\p{P}\p{S}\p{Emoji}]+$/u.test(s); }
  function isChinese(s)  { return /[\u3400-\u9FFF]/.test(s); }
  function isPureChinese(s) { return isChinese(s) && !isJapanese(s); }
  function isTargetLang(s) { return isChinese(s) || isJapanese(s) || isEnglish(s); }

  function checkChineseType(s) {
    const trad = (s.match(/[卒妳慾鍊簷籤処迴鑑躙霊乾牝罠郷孃豔壊闇鬱戯艶僕癒彆闆麵囉閒週鬆髮係裡姦姊錒皚藹礙愛噯嬡璦曖靄諳銨鵪骯襖奧媼驁鰲壩罷鈀擺敗唄頒辦絆鈑幫綁鎊謗剝飽寶報鮑鴇齙輩貝鋇狽備憊鵯賁錛繃筆畢斃幣閉蓽嗶潷鉍篳蹕邊編貶變辯辮芐緶籩標驃颮飆鏢鑣鰾鱉別癟瀕濱賓擯儐繽檳殯臏鑌髕鬢餅稟撥缽鉑駁餑鈸鵓補鈽財參蠶殘慚慘燦驂黲蒼艙倉滄廁側冊測惻層詫鍤儕釵攙摻蟬饞讒纏鏟產闡顫囅諂讖蕆懺嬋驏覘禪鐔場嘗長償腸廠暢倀萇悵閶鯧鈔車徹硨塵陳襯傖諶櫬磣齔撐稱懲誠騁棖檉鋮鐺癡遲馳恥齒熾飭鴟沖衝蟲寵銃疇躊籌綢儔幬讎櫥廚鋤雛礎儲觸處芻絀躕傳釧瘡闖創愴錘綞純鶉綽輟齪辭詞賜鶿聰蔥囪從叢蓯驄樅湊輳躥竄攛錯銼鹺達噠韃帶貸駘紿擔單鄲撣膽憚誕彈殫賧癉簞當擋黨蕩檔讜碭襠搗島禱導盜燾燈鄧鐙敵滌遞締糴詆諦綈覿鏑顛點墊電巔鈿癲釣調銚鯛諜疊鰈釘頂錠訂鋌丟銩東動棟凍崠鶇竇犢獨讀賭鍍瀆櫝牘篤黷鍛斷緞籪兌隊對懟鐓噸頓鈍燉躉奪墮鐸鵝額訛惡餓諤堊閼軛鋨鍔鶚顎顓鱷誒兒爾餌貳邇鉺鴯鮞發罰閥琺礬釩煩販飯訪紡鈁魴飛誹廢費緋鐨鯡紛墳奮憤糞僨豐楓鋒風瘋馮縫諷鳳灃膚輻撫輔賦復負訃婦縛鳧駙紱紼賻麩鮒鰒釓該鈣蓋賅桿趕稈贛尷搟紺岡剛鋼綱崗戇鎬睪誥縞鋯擱鴿閣鉻個紇鎘潁給亙賡綆鯁龔宮鞏貢鉤溝茍構購夠詬緱覯蠱顧詁轂鈷錮鴣鵠鶻剮掛鴰摑關觀館慣貫詿摜鸛鰥廣獷規歸龜閨軌詭貴劊匭劌媯檜鮭鱖輥滾袞緄鯀鍋國過堝咼幗槨蟈鉿駭韓漢闞絎頡號灝顥閡鶴賀訶闔蠣橫轟鴻紅黌訌葒閎鱟壺護滬戶滸鶘嘩華畫劃話驊樺鏵懷壞歡環還緩換喚瘓煥渙奐繯鍰鯇黃謊鰉揮輝毀賄穢會燴匯諱誨繪詼薈噦澮繢琿暉葷渾諢餛閽獲貨禍鈥鑊擊機積饑跡譏雞績緝極輯級擠幾薊劑濟計記際繼紀訐詰薺嘰嚌驥璣覬齏磯羈蠆躋霽鱭鯽夾莢頰賈鉀價駕郟浹鋏鎵蟯殲監堅箋間艱緘繭檢堿鹼揀撿簡儉減薦檻鑒踐賤見鍵艦劍餞漸濺澗諫縑戔戩瞼鶼筧鰹韉將漿蔣槳獎講醬絳韁膠澆驕嬌攪鉸矯僥腳餃繳絞轎較撟嶠鷦鮫階節潔結誡屆癤頜鮚緊錦僅謹進晉燼盡勁荊莖巹藎饉縉贐覲鯨驚經頸靜鏡徑痙競凈剄涇逕弳脛靚糾廄舊鬮鳩鷲駒舉據鋸懼劇詎屨櫸颶鉅鋦窶齟鵑絹錈鐫雋覺決絕譎玨鈞軍駿皸開凱剴塏愾愷鎧鍇龕閌鈧銬顆殼課騍緙軻鈳錁頷墾懇齦鏗摳庫褲嚳塊儈鄶噲膾寬獪髖礦曠況誆誑鄺壙纊貺虧巋窺饋潰匱蕢憒聵簣閫錕鯤擴闊蠐蠟臘萊來賴崍徠淶瀨賚睞錸癩籟藍欄攔籃闌蘭瀾讕攬覽懶纜爛濫嵐欖斕鑭襤瑯閬鋃撈勞澇嘮嶗銠鐒癆樂鰳鐳壘類淚誄縲籬貍離鯉禮麗厲勵礫歷瀝隸儷酈壢藶蒞蘺嚦邐驪縭櫪櫟轢礪鋰鸝癘糲躒靂鱺鱧倆聯蓮連鐮憐漣簾斂臉鏈戀煉練蘞奩瀲璉殮褳襝鰱糧涼兩輛諒魎療遼鐐繚釕鷯獵臨鄰鱗凜賃藺廩檁轔躪齡鈴靈嶺領綾欞蟶鯪餾劉瀏騮綹鎦鷚龍竜聾嚨籠壟攏隴蘢瀧瓏櫳朧礱樓婁摟簍僂蔞嘍嶁鏤瘺耬螻髏蘆盧顱廬爐擄鹵虜魯賂祿錄陸壚擼嚕閭瀘淥櫨櫓轤輅轆氌臚鸕鷺艫鱸巒攣孿灤亂臠孌欒鸞鑾掄輪倫侖淪綸論圇蘿羅邏鑼籮騾駱絡犖玀濼欏腡鏍驢呂鋁侶屢縷慮濾綠櫚褸鋝嘸媽瑪碼螞馬罵嗎嘜嬤榪買麥賣邁脈勱瞞饅蠻滿謾縵鏝顙鰻貓錨鉚貿麼沒鎂門悶們捫燜懣鍆錳夢瞇謎彌覓冪羋謐獼禰綿緬澠靦黽廟緲繆滅憫閩閔緡鳴銘謬謨驀饃歿鏌謀畝鉬吶鈉納難撓腦惱鬧鐃訥餒內擬膩鈮鯢攆輦鯰釀鳥蔦裊聶嚙鑷鎳隉蘗囁顢躡檸獰寧擰濘苧嚀聹鈕紐膿濃農儂噥駑釹諾儺瘧歐鷗毆嘔漚謳慪甌盤蹣龐拋皰賠轡噴鵬紕羆鈹騙諞駢飄縹頻貧嬪蘋憑評潑頗釙撲鋪樸譜鏷鐠棲臍齊騎豈啟氣棄訖蘄騏綺榿磧頎頏鰭牽釬鉛遷簽謙錢鉗潛淺譴塹僉蕁慳騫繾槧鈐槍嗆墻薔強搶嬙檣戧熗錆鏘鏹羥蹌鍬橋喬僑翹竅誚譙蕎繰磽蹺竊愜鍥篋欽親寢鋟輕氫傾頃請慶撳鯖瓊窮煢蛺巰賕蟣鰍趨區軀驅齲詘嶇闃覷鴝顴權勸詮綣輇銓卻鵲確闋闕愨讓饒擾繞蕘嬈橈熱韌認紉飪軔榮絨嶸蠑縟銣顰軟銳蜆閏潤灑薩颯鰓賽傘毿糝喪騷掃繅澀嗇銫穡殺剎紗鎩鯊篩曬釃刪閃陜贍繕訕姍騸釤鱔墑傷賞坰殤觴燒紹賒攝懾設厙灄畬紳審嬸腎滲詵諗瀋聲繩勝師獅濕詩時蝕實識駛勢適釋飾視試謚塒蒔弒軾貰鈰鰣壽獸綬樞輸書贖屬術樹豎數攄紓帥閂雙誰稅順說碩爍鑠絲飼廝駟緦鍶鷥聳慫頌訟誦擻藪餿颼鎪蘇訴肅謖穌雖隨綏歲誶孫損筍蓀猻縮瑣鎖嗩脧獺撻闥鉈鰨臺態鈦鮐攤貪癱灘壇譚談嘆曇鉭錟頇湯燙儻餳鐋鏜濤絳討韜鋱騰謄銻題體屜緹鵜闐條糶齠鰷貼鐵廳聽烴銅統慟頭鈄禿圖釷團摶頹蛻飩脫鴕馱駝橢籜鼉襪媧膃彎灣頑萬紈綰網輞韋違圍為濰維葦偉偽緯謂衛諉幃闈溈潿瑋韙煒鮪溫聞紋穩問閿甕撾蝸渦窩臥萵齷嗚鎢烏誣無蕪吳塢霧務誤鄔廡憮嫵騖鵡鶩錫犧襲習銑戲細餼鬩璽覡蝦轄峽俠狹廈嚇硤鮮纖賢銜閑顯險現獻縣餡羨憲線莧薟蘚峴獫嫻鷴癇蠔秈躚廂鑲鄉詳響項薌餉驤緗饗蕭囂銷曉嘯嘵瀟驍綃梟簫協挾攜脅諧寫瀉謝褻擷紲纈鋅釁興陘滎兇洶銹繡饈鵂虛噓須許敘緒續詡頊軒懸選癬絢諼鉉鏇學謔澩鱈勛詢尋馴訓訊遜塤潯鱘壓鴉鴨啞亞訝埡婭椏氬閹煙鹽嚴巖顏閻艷厭硯彥諺驗厴贗儼兗讞懨閆釅魘饜鼴鴦楊揚瘍陽癢養樣煬瑤搖堯遙窯謠藥軺鷂鰩爺頁業葉靨謁鄴曄燁醫銥頤遺儀蟻藝億憶義詣議誼譯異繹詒囈嶧飴懌驛縊軼貽釔鎰鐿瘞艤蔭陰銀飲隱銦癮櫻嬰鷹應纓瑩螢營熒蠅贏穎塋鶯縈鎣攖嚶瀅瀠瓔鸚癭頦罌喲擁傭癰踴詠鏞優憂郵鈾猶誘蕕銪魷輿魚漁娛與嶼語獄譽預馭傴俁諛諭蕷崳飫閾嫗紆覦歟鈺鵒鷸齬鴛淵轅園員圓緣遠櫞鳶黿約躍鑰粵悅閱鉞鄖勻隕運蘊醞暈韻鄆蕓惲慍紜韞殞氳雜災載攢暫贊瓚趲鏨贓臟駔鑿棗責擇則澤賾嘖幘簀賊譖贈綜繒軋鍘閘柵詐齋債氈盞斬輾嶄棧戰綻譫張漲帳賬脹趙詔釗蟄轍鍺這謫輒鷓貞針偵診鎮陣湞縝楨軫賑禎鴆掙睜猙爭幀癥鄭證諍崢鉦錚箏織職執紙摯擲幟質滯騭櫛梔軹輊贄鷙螄縶躓躑觶鐘終種腫眾鍾謅軸皺晝驟紂縐豬諸誅燭矚囑貯鑄駐佇櫧銖專磚轉賺囀饌顳樁莊裝妝壯狀錐贅墜綴騅縋諄準著濁諑鐲茲資漬諮緇輜貲眥錙齜鯔蹤總縱傯鄒諏騶鯫詛組鏃鉆纘躦鱒翺並蔔沈醜澱叠鬥範幹臯矽櫃後夥稭傑訣誇裏淩麽黴撚淒扡聖屍擡塗窪餵汙鍁鹹蠍彜湧遊籲禦願嶽雲竈紮劄築於誌註雕訁譾郤猛氹阪壟堖垵墊檾蕒葤蓧蒓菰槁摣咤唚哢噝噅撅劈謔襆嶴脊仿僥獁麅餘餷饊饢楞怵懍爿漵灩溷濫瀦澹寧糸絝緔瑉梘棬案橰櫫軲軤賫膁腖飈糊煆溜湣渺碸滾瞘鈈鉕鋣銱鋥鋶鐦鐧鍩鍀鍃錇鎄鎇鎿鐝鑥鑹鑔穭鶓鶥鸌癧屙瘂臒襇繈耮顬蟎麯鮁鮃鮎鯗鯝鯴鱝鯿鰠鰵鱅鞽韝齇]/g)||[]).length;
    const simp = (s.match(/[毕你欲炼檐签处回鉴躏灵干牝陷乡娘艳坏暗郁戏艳仆愈别板面啰闲周松发系里奸姐锕皑蔼碍爱嗳嫒瑷暧霭谙铵鹌肮袄奥媪骜鳌坝罢钯摆败呗颁办绊钣帮绑镑谤剥饱宝报鲍鸨龅辈贝钡狈备惫鹎贲锛绷笔毕毙币闭荜哔滗铋筚跸边编贬变辩辫苄缏笾标骠飑飙镖镳鳔鳖别瘪濒滨宾摈傧缤槟殡膑镔髌鬓饼禀拨钵铂驳饽钹鹁补钸财参蚕残惭惨灿骖黪苍舱仓沧厕侧册测恻层诧锸侪钗搀掺蝉馋谗缠铲产阐颤冁谄谶蒇忏婵骣觇禅镡场尝长偿肠厂畅伥苌怅阊鲳钞车彻砗尘陈衬伧谌榇碜龀撑称惩诚骋枨柽铖铛痴迟驰耻齿炽饬鸱冲冲虫宠铳畴踌筹绸俦帱雠橱厨锄雏础储触处刍绌蹰传钏疮闯创怆锤缍纯鹑绰辍龊辞词赐鹚聪葱囱从丛苁骢枞凑辏蹿窜撺错锉鹾达哒鞑带贷骀绐担单郸掸胆惮诞弹殚赕瘅箪当挡党荡档谠砀裆捣岛祷导盗焘灯邓镫敌涤递缔籴诋谛绨觌镝颠点垫电巅钿癫钓调铫鲷谍叠鲽钉顶锭订铤丢铥东动栋冻岽鸫窦犊独读赌镀渎椟牍笃黩锻断缎簖兑队对怼镦吨顿钝炖趸夺堕铎鹅额讹恶饿谔垩阏轭锇锷鹗颚颛鳄诶儿尔饵贰迩铒鸸鲕发罚阀珐矾钒烦贩饭访纺钫鲂飞诽废费绯镄鲱纷坟奋愤粪偾丰枫锋风疯冯缝讽凤沣肤辐抚辅赋复负讣妇缚凫驸绂绋赙麸鲋鳆钆该钙盖赅杆赶秆赣尴擀绀冈刚钢纲岗戆镐睾诰缟锆搁鸽阁铬个纥镉颍给亘赓绠鲠龚宫巩贡钩沟苟构购够诟缑觏蛊顾诂毂钴锢鸪鹄鹘剐挂鸹掴关观馆惯贯诖掼鹳鳏广犷规归龟闺轨诡贵刽匦刿妫桧鲑鳜辊滚衮绲鲧锅国过埚呙帼椁蝈铪骇韩汉阚绗颉号灏颢阂鹤贺诃阖蛎横轰鸿红黉讧荭闳鲎壶护沪户浒鹕哗华画划话骅桦铧怀坏欢环还缓换唤痪焕涣奂缳锾鲩黄谎鳇挥辉毁贿秽会烩汇讳诲绘诙荟哕浍缋珲晖荤浑诨馄阍获货祸钬镬击机积饥迹讥鸡绩缉极辑级挤几蓟剂济计记际继纪讦诘荠叽哜骥玑觊齑矶羁虿跻霁鲚鲫夹荚颊贾钾价驾郏浃铗镓蛲歼监坚笺间艰缄茧检碱硷拣捡简俭减荐槛鉴践贱见键舰剑饯渐溅涧谏缣戋戬睑鹣笕鲣鞯将浆蒋桨奖讲酱绛缰胶浇骄娇搅铰矫侥脚饺缴绞轿较挢峤鹪鲛阶节洁结诫届疖颌鲒紧锦仅谨进晋烬尽劲荆茎卺荩馑缙赆觐鲸惊经颈静镜径痉竞净刭泾迳弪胫靓纠厩旧阄鸠鹫驹举据锯惧剧讵屦榉飓钜锔窭龃鹃绢锩镌隽觉决绝谲珏钧军骏皲开凯剀垲忾恺铠锴龛闶钪铐颗壳课骒缂轲钶锞颔垦恳龈铿抠库裤喾块侩郐哙脍宽狯髋矿旷况诓诳邝圹纩贶亏岿窥馈溃匮蒉愦聩篑阃锟鲲扩阔蛴蜡腊莱来赖崃徕涞濑赉睐铼癞籁蓝栏拦篮阑兰澜谰揽览懒缆烂滥岚榄斓镧褴琅阆锒捞劳涝唠崂铑铹痨乐鳓镭垒类泪诔缧篱狸离鲤礼丽厉励砾历沥隶俪郦坜苈莅蓠呖逦骊缡枥栎轹砺锂鹂疠粝跞雳鲡鳢俩联莲连镰怜涟帘敛脸链恋炼练蔹奁潋琏殓裢裣鲢粮凉两辆谅魉疗辽镣缭钌鹩猎临邻鳞凛赁蔺廪檩辚躏龄铃灵岭领绫棂蛏鲮馏刘浏骝绺镏鹨龙龙聋咙笼垄拢陇茏泷珑栊胧砻楼娄搂篓偻蒌喽嵝镂瘘耧蝼髅芦卢颅庐炉掳卤虏鲁赂禄录陆垆撸噜闾泸渌栌橹轳辂辘氇胪鸬鹭舻鲈峦挛孪滦乱脔娈栾鸾銮抡轮伦仑沦纶论囵萝罗逻锣箩骡骆络荦猡泺椤脶镙驴吕铝侣屡缕虑滤绿榈褛锊呒妈玛码蚂马骂吗唛嬷杩买麦卖迈脉劢瞒馒蛮满谩缦镘颡鳗猫锚铆贸么没镁门闷们扪焖懑钔锰梦眯谜弥觅幂芈谧猕祢绵缅渑腼黾庙缈缪灭悯闽闵缗鸣铭谬谟蓦馍殁镆谋亩钼呐钠纳难挠脑恼闹铙讷馁内拟腻铌鲵撵辇鲶酿鸟茑袅聂啮镊镍陧蘖嗫颟蹑柠狞宁拧泞苎咛聍钮纽脓浓农侬哝驽钕诺傩疟欧鸥殴呕沤讴怄瓯盘蹒庞抛疱赔辔喷鹏纰罴铍骗谝骈飘缥频贫嫔苹凭评泼颇钋扑铺朴谱镤镨栖脐齐骑岂启气弃讫蕲骐绮桤碛颀颃鳍牵钎铅迁签谦钱钳潜浅谴堑佥荨悭骞缱椠钤枪呛墙蔷强抢嫱樯戗炝锖锵镪羟跄锹桥乔侨翘窍诮谯荞缲硗跷窃惬锲箧钦亲寝锓轻氢倾顷请庆揿鲭琼穷茕蛱巯赇虮鳅趋区躯驱龋诎岖阒觑鸲颧权劝诠绻辁铨却鹊确阕阙悫让饶扰绕荛娆桡热韧认纫饪轫荣绒嵘蝾缛铷颦软锐蚬闰润洒萨飒鳃赛伞毵糁丧骚扫缫涩啬铯穑杀刹纱铩鲨筛晒酾删闪陕赡缮讪姗骟钐鳝墒伤赏垧殇觞烧绍赊摄慑设厍滠畲绅审婶肾渗诜谂渖声绳胜师狮湿诗时蚀实识驶势适释饰视试谥埘莳弑轼贳铈鲥寿兽绶枢输书赎属术树竖数摅纾帅闩双谁税顺说硕烁铄丝饲厮驷缌锶鸶耸怂颂讼诵擞薮馊飕锼苏诉肃谡稣虽随绥岁谇孙损笋荪狲缩琐锁唢睃獭挞闼铊鳎台态钛鲐摊贪瘫滩坛谭谈叹昙钽锬顸汤烫傥饧铴镗涛绦讨韬铽腾誊锑题体屉缇鹈阗条粜龆鲦贴铁厅听烃铜统恸头钭秃图钍团抟颓蜕饨脱鸵驮驼椭箨鼍袜娲腽弯湾顽万纨绾网辋韦违围为潍维苇伟伪纬谓卫诿帏闱沩涠玮韪炜鲔温闻纹稳问阌瓮挝蜗涡窝卧莴龌呜钨乌诬无芜吴坞雾务误邬庑怃妩骛鹉鹜锡牺袭习铣戏细饩阋玺觋虾辖峡侠狭厦吓硖鲜纤贤衔闲显险现献县馅羡宪线苋莶藓岘猃娴鹇痫蚝籼跹厢镶乡详响项芗饷骧缃飨萧嚣销晓啸哓潇骁绡枭箫协挟携胁谐写泻谢亵撷绁缬锌衅兴陉荥凶汹锈绣馐鸺虚嘘须许叙绪续诩顼轩悬选癣绚谖铉镟学谑泶鳕勋询寻驯训讯逊埙浔鲟压鸦鸭哑亚讶垭娅桠氩阉烟盐严岩颜阎艳厌砚彦谚验厣赝俨兖谳恹闫酽魇餍鼹鸯杨扬疡阳痒养样炀瑶摇尧遥窑谣药轺鹞鳐爷页业叶靥谒邺晔烨医铱颐遗仪蚁艺亿忆义诣议谊译异绎诒呓峄饴怿驿缢轶贻钇镒镱瘗舣荫阴银饮隐铟瘾樱婴鹰应缨莹萤营荧蝇赢颖茔莺萦蓥撄嘤滢潆璎鹦瘿颏罂哟拥佣痈踊咏镛优忧邮铀犹诱莸铕鱿舆鱼渔娱与屿语狱誉预驭伛俣谀谕蓣嵛饫阈妪纡觎欤钰鹆鹬龉鸳渊辕园员圆缘远橼鸢鼋约跃钥粤悦阅钺郧匀陨运蕴酝晕韵郓芸恽愠纭韫殒氲杂灾载攒暂赞瓒趱錾赃脏驵凿枣责择则泽赜啧帻箦贼谮赠综缯轧铡闸栅诈斋债毡盏斩辗崭栈战绽谵张涨帐账胀赵诏钊蛰辙锗这谪辄鹧贞针侦诊镇阵浈缜桢轸赈祯鸩挣睁狰争帧症郑证诤峥钲铮筝织职执纸挚掷帜质滞骘栉栀轵轾贽鸷蛳絷踬踯觯钟终种肿众锺诌轴皱昼骤纣绉猪诸诛烛瞩嘱贮铸驻伫槠铢专砖转赚啭馔颞桩庄装妆壮状锥赘坠缀骓缒谆准着浊诼镯兹资渍谘缁辎赀眦锱龇鲻踪总纵偬邹诹驺鲰诅组镞钻缵躜鳟翱并卜沉丑淀迭斗范干皋硅柜后伙秸杰诀夸里凌么霉捻凄扦圣尸抬涂洼喂污锨咸蝎彝涌游吁御愿岳云灶扎札筑于志注凋讠谫郄猛凼坂垅垴埯埝苘荬荮莜莼菇藁揸吒吣咔咝咴噘噼嚯幞岙嵴彷徼犸狍馀馇馓馕愣憷懔丬溆滟混漤潴淡甯纟绔绱珉枧桊桉槔橥轱轷赍肷胨飚煳煅熘愍淼砜磙眍钚钷铘铞锃锍锎锏锘锝锪锫锿镅镎镢镥镩镲稆鹋鹛鹱疬疴痖癯裥襁耢颥螨麴鲅鲆鲇鲞鲴鲺鲼鳊鳋鳘鳙鞒鞴齄]/g)||[]).length;
    return trad > simp ? 1 : 0;
  }

  function addUnique(arr, val) { if (arr.indexOf(val)===-1) arr.push(val); }
  function formatDate(str) {
    const m=str.match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})日?/);
    if(m) return `${m[1]}年${m[2].padStart(2,'0')}月${m[3].padStart(2,'0')}日`;
    const m2=str.match(/(\d{4})[-./年](\d{1,2})月?/);
    if(m2) return `${m2[1]}年${m2[2].padStart(2,'0')}月`;
    const m3=str.match(/(\d{4})/);
    if(m3) return `${m3[1]}年`;
    return str;
  }

  function extractEnglishNames(str) { if(!str) return []; const m = str.match(/\[([A-Za-z0-9\s\-!:&'’.\u00C0-\u024F]+)\]/g); return m ? m.map(s=>s.slice(1,-1).trim()).filter(Boolean) : []; }
  function extractJapaneseName(str) { if(!str) return null; const m = str.match(/\[([\u3040-\u309F\u30A0-\u30FFー]+)\]/); return m ? m[1] : null; }
  function extractChineseNames(str) { if(!str) return []; const m = str.match(/\[([\u3400-\u9FFF][^\]]*)\]/g); return m ? m.map(s=>s.slice(1,-1).trim()).filter(Boolean) : []; }
  function extractBangumiDate(line) { const m=line.match(/(\d{4})年(\d{2})月(\d{2})日/)||line.match(/(\d{4})年/); return m?{year:+m[1], month:m[2]?+m[2]:null}:null; }

  // 提取季数/部分关键词
  function extractRequiredKeywords(line) {
    const required = new Set();
    const allText = line.replace(/\[.*?\]/g, ' $& ').toLowerCase();
    const patterns = [
      /第\s*(\d+)\s*部分/g,
      /part\s*(\d+)/g,
      /第\s*(\d+)\s*季/g,
      /season\s*(\d+)/g,
      /(\d+)(?:nd|rd|th)\s*season/g,
      /第\s*(\d+)\s*クール/g
    ];
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(allText)) !== null) {
        required.add(match[0].toLowerCase());
      }
    }
    return [...required];
  }

  // 过滤译名：仅保留包含季数关键词或括号年份的条目；若有关键词但无匹配条目，返回空字符串
  function filterTitlesByKeywords(rawTitles, keywords) {
    if (!keywords || keywords.length === 0) return rawTitles;
    const matches = rawTitles.match(/\[(.*?)\]/g) || [];
    const filtered = [];
    for (const m of matches) {
      const title = m.slice(1, -1).trim();
      const hasKeyword = keywords.some(kw => title.toLowerCase().includes(kw));
      const hasYearBracket = /\(\d{4}\)/.test(title);
      if (hasKeyword || hasYearBracket) {
        filtered.push(`[${title}]`);
      }
    }
    return filtered.join('');
  }

  // 提取用于评分的季数关键词
  function extractSeasonKeywords(st,bl) {
    const kws=[], comb=st+' '+bl;
    const sm=comb.match(/Season\s*(\d+)/i);
    if(sm){ const n=sm[1]; kws.push(`season ${n}`,`${n}nd season`,`${n}rd season`,`${n}th season`); if(n==='2') kws.push('2nd season','II'); if(n==='3') kws.push('3rd season','III'); }
    const cm=comb.match(/第\s*(\d+)\s*季/); if(cm){ const s=cm[1]; kws.push(`第${s}期`,`第${s}季`,`(${s})`); }
    const ym=comb.match(/(\d{4})/); if(ym) kws.push(ym[1]);
    return [...new Set(kws)];
  }

  function extractKeyFragments(str) { const c=str.replace(/[^\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFー]/g,' ').replace(/\s+/g,' '); return c.split(' ').filter(w=>w.length>=4&&!/^\d+$/.test(w)&&!/^[A-Za-z]$/.test(w)); }
  function containsMinFragments(text,frags,min=2) { if(!frags||!frags.length) return true; if(frags.length<min) min=frags.length; const lt=text.toLowerCase(); let cnt=0; for(const f of frags){ if(lt.includes(f.toLowerCase())) cnt++; if(cnt>=min) return true; } return false; }

  /* ---------- 面板样式 ---------- */
  GM_addStyle(`
    #gm-super-panel {
      position: fixed; top: 80px; right: 20px; z-index: 999999; width: 380px;
      background: rgba(20, 20, 30, 0.92); backdrop-filter: blur(16px);
      border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
      color: #fff; font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      padding: 0; line-height: 1.5; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }
    #gm-super-panel.collapsed { width: 180px; }
    #gm-super-panel .panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.1);
      cursor: pointer; user-select: none;
    }
    #gm-super-panel .panel-header .title { font-weight: 600; font-size: 14px; letter-spacing: 0.5px; }
    #gm-super-panel .panel-header .toggle-btn {
      background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer;
      padding: 0 4px; transition: color 0.2s;
    }
    #gm-super-panel .panel-header .toggle-btn:hover { color: #fff; }
    #gm-super-panel .panel-content { padding: 8px 14px 12px; }
    #gm-super-panel.collapsed .panel-content { display: none; }
    #gm-super-panel .log-area {
      max-height: ${PANEL_MAX_HEIGHT}px; overflow-y: auto; margin-bottom: 8px;
      font-size: 14px; padding-right: 4px;
    }
    #gm-super-panel .log-area::-webkit-scrollbar { width: 5px; }
    #gm-super-panel .log-area::-webkit-scrollbar-track { background: transparent; }
    #gm-super-panel .log-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
    #gm-super-panel .log-item {
      border-bottom: 1px solid rgba(255,255,255,0.06); padding: 5px 0;
    }
    #gm-super-panel .log-item:last-child { border-bottom: none; }
    #gm-super-panel .log-item .time { color: #888; font-size: 10px; margin-right: 4px; }
    #gm-super-panel .log-item .status-ok { color: #4CAF50; font-weight: 500; }
    #gm-super-panel .log-item .status-fail { color: #e74c3c; font-weight: 500; }
    #gm-super-panel .detail-btn { color: #58a6ff; cursor: pointer; margin-left: 6px; font-size: 11px; }
    #gm-super-panel .detail-btn:hover { text-decoration: underline; }
    #gm-super-panel .detail-list {
      margin-top: 4px; padding-left: 10px; color: #eee; font-size: 14px;
      word-break: break-all; display: block;
    }
    #gm-super-panel .detail-list.hidden { display: none; }
    #gm-copy-btn {
      width: 100%; background: #4CAF50; border: none; color: white; font-weight: bold;
      padding: 8px 0; border-radius: 6px; cursor: pointer; transition: background 0.2s, opacity 0.2s;
      margin-top: 5px; font-size: 14px; letter-spacing: 0.5px;
    }
    #gm-copy-btn.loading { background: #FF9800; pointer-events: none; opacity: 0.9; }
    #gm-copy-btn:hover { background: #43A047; }
    .gm-copy-bubble {
      position: fixed; bottom: 80px; right: 30px; background: rgba(20,20,30,0.92);
      backdrop-filter: blur(12px); color: #fff; padding: 12px 16px; border-radius: 8px;
      z-index: 9999999; font-size: 14px; max-width: 350px; word-break: break-all;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
      display: none;
    }
    .gm-preview {
      margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.06);
      border-radius: 6px; color: #ddd; font-size: 14px; word-break: break-all;
      border: 1px solid rgba(255,255,255,0.08);
    }
  `);

  /* ---------- 面板创建 ---------- */
  function createPanel() {
    $('body').append(`<div id="gm-super-panel"><div class="panel-header"><span class="title">🌐 译名聚合</span><button class="toggle-btn" id="gm-toggle-btn">－</button></div><div class="panel-content"><div class="log-area" id="gm-log-area"></div><div id="gm-preview" class="gm-preview" style="display:none;"></div><button id="gm-copy-btn" class="loading" disabled>📋 等待数据…</button></div></div>`);
    $('#gm-toggle-btn').click(e=>{ e.stopPropagation(); const p=$('#gm-super-panel'); p.toggleClass('collapsed'); $(e.target).text(p.hasClass('collapsed')?'＋':'－'); });
    $('body').append('<div class="gm-copy-bubble" id="gm-copy-bubble"></div>');
  }

  function countUniqueInResult(text) {
    if (!text) return 0;
    const cleanText = text.replace(/\s*\d{4}年(?:\d{2}月\d{2}日|\d{2}月)?\s*共\d+集\s*$/g, '').trim();
    const set = new Set();
    const brackets = cleanText.match(/\[(.*?)\]/g);
    if (brackets) {
      brackets.forEach(b => { const name = b.slice(1, -1).trim(); if (name && name !== '···') set.add(name); });
    }
    const firstBracket = cleanText.indexOf('[');
    let mainTitle = '';
    if (firstBracket > 0) mainTitle = cleanText.substring(0, firstBracket).trim();
    else if (!brackets || brackets.length === 0) mainTitle = cleanText;
    if (mainTitle) set.add(mainTitle);
    return set.size;
  }

  function refreshAllLogs() {
    const area = $('#gm-log-area');
    area.empty();
    const circle = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
    logCache.forEach(entry => {
      const { timeStr, cls, site, message, extra, titleList, localNames } = entry;
      let detailHtml = '';
      if (titleList && titleList.length) {
        const localUnique = new Set(localNames).size;
        let formatted = '';
        titleList.forEach((item, idx) => {
          const global = globalTitleCount.get(item.name) || 1;
          const cntStr = global <= 20 ? circle[global-1] : `(${global})`;
          const safe = item.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          formatted += `<br>${String(idx+1).padStart(2,'0')}. ${safe} ${cntStr}`;
        });
        formatted += `<br><b>共${localUnique}个译名</b>`;
        detailHtml = `<span class="detail-btn" onclick="$(this).next('.detail-list').toggleClass('hidden')">▶ ${titleList.length}条详情</span><div class="detail-list">${formatted}</div>`;
      }
      area.append(`<div class="log-item"><span class="time">[${timeStr}]</span><span class="${cls}">${site}</span> ${message}${extra||''} ${detailHtml}</div>`);
    });

    if (globalTitleCount.size > 0) {
      const duplicates = [];
      for (const [name, count] of globalTitleCount.entries()) {
        if (count >= 2) duplicates.push({ name, count });
      }
      if (duplicates.length > 0) {
        duplicates.sort((a,b) => b.count - a.count);
        let dupHtml = '<div class="log-item"><b>重复名统计</b><br>';
        duplicates.forEach((item, idx) => {
          const cntStr = item.count <= 20 ? circle[item.count-1] : `(${item.count})`;
          dupHtml += `${String(idx+1).padStart(2,'0')}. ${item.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')} ${cntStr}<br>`;
        });
        const totalAll = Array.from(globalTitleCount.values()).reduce((a,b) => a + b, 0);
        const finalUnique = countUniqueInResult(finalText);
        dupHtml += `<b>共${duplicates.length}个重复名 / 实际共${totalAll}个番名 / 去重后${finalUnique}个番名</b></div>`;
        area.append(dupHtml);
      }
    }
    area.scrollTop(area[0].scrollHeight);
  }

  function addLog(site, message, isOk, rawText, hitWord, titleList, localNames) {
    const timeStr = new Date().toTimeString().slice(0,8);
    const cls = isOk ? 'status-ok' : 'status-fail';
    let extra = hitWord ? ` (命中词: ${hitWord})` : '';
    logCache.push({ timeStr, cls, site, message, extra, titleList: titleList || [], localNames: localNames || [] });
  }

  function updatePreview(text) {
    $('#gm-preview').html('<b>复制预览</b><br>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).show();
  }

  function showCopyBubble(text) {
    const $b = $('#gm-copy-bubble');
    $b.text('✅ 已复制：' + (text.length>120 ? text.substring(0,120)+'...' : text));
    $b.fadeIn(300).delay(4000).fadeOut(300);
  }

  // ---------- 网络请求 ----------
  function gmRequest(url,type='text',headers={}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:'GET', url, timeout:20000,
        responseType: type==='json'?'json':(type==='arraybuffer'?'arraybuffer':'text'),
        headers: Object.assign({'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, headers),
        onload(r) {
          try {
            if(type==='json') resolve(typeof r.response==='object'?r.response:JSON.parse(r.response));
            else if(type==='arraybuffer') resolve(r.response);
            else resolve(r.response);
          } catch(e) { reject(new Error('解析失败')); }
        },
        onerror: ()=>reject(new Error('网络错误')),
        ontimeout: ()=>reject(new Error('请求超时'))
      });
    });
  }

  // ---------- Bangumi 基础行 ----------
  function generateBangumiLine() {
    const listObj = { zhName:[], jpZhName:[], sum:[], data:[] };
    let titleName='', JpEnName='', EnName=[];
    const EXCLUDE = ['漫画','动画','小说','游戏','WEB','OVA','Movie','电影','TV','Film','OAD','ONA'];

    const $small = $('.nameSingle small');
    if($small.length){ const t=$small.first().text().trim(); if(!EXCLUDE.includes(t)) titleName=t; }
    if(!titleName) titleName = $('.nameSingle a').text().trim();

    $('#infobox li span').each(function() {
      const self = $(this).html();
      if(self==='中文名: ') listObj.zhName.push($(this).parent().text().substr(4).trim().replace(/\)/g,']').replace(/\(/g,'['));
      else if(self==='话数: '||self==='集数: ') listObj.sum.push($(this).parent().text().substr(3).trim());
      else if(self==='别名: ') $(this).parent().text().substr(3).trim().split(/[,，\n]/).forEach(p=>{ const c=p.trim(); if(c&&!EXCLUDE.includes(c)&&c!=='···') listObj.jpZhName.push(c); });
      else if(/放送开始|发售日期|发售日|上映年度|发行日期|开始/.test(self)) listObj.data.push(formatDate($(this).parent().text().substr(4).trim()));
    });

    $('#infobox li').each(function() {
      const $li=$(this), $sp=$li.find('span');
      if($sp.text().includes('罗马名: ')) JpEnName=$li.text().replace($sp.text(),'').trim();
      if($sp.text().includes('英文名: ')||$sp.text().includes('拼音名: ')) { const v=$li.text().replace($sp.text(),'').trim(); if(v&&v!=='NULL'&&v!=='···') EnName.push(v); }
    });

    const allArr = [...new Set([...listObj.zhName, ...listObj.jpZhName, ...(JpEnName&&JpEnName!=='NULL'?[JpEnName]:[]), ...EnName])];
    const cnMain=[], cnAlias=[], tw=[], ja=[], en=[];
    function classify(str) {
      const v=str.trim(); if(!v) return;
      if(isJapanese(v)){ ja.push(v); return; }
      if(isChinese(v)){ if(checkChineseType(v)===0){ if(cnMain.length===0) cnMain.push(v); else cnAlias.push(v); } else tw.push(v); return; }
      if(isEnglish(v)){ en.push(v); return; }
      if(ALLOW_OTHER_LANGS) en.push(v);
    }
    allArr.forEach(classify);
    if(titleName && !allArr.includes(titleName)) classify(titleName);

    let line = cnMain[0]||'';
    const others = [...cnAlias, ...tw, ...ja, ...en].filter(t=>t!==line&&t!=='···');
    if(others.length) line += '[' + others.join('][') + ']';
    const dateStr = listObj.data[0]||'';
    if(dateStr) line += ' ' + dateStr;
    const sumStr = listObj.sum[0] ? ' 共' + listObj.sum[0].replace('话','').replace('集','') + '集' : '';
    if(sumStr) line += sumStr;
    const allNames = [...new Set([cnMain[0], ...cnAlias, ...tw, ...ja, ...en].filter(t=>t&&t!=='···'))];
    return { line, allNames, date: dateStr, sum: sumStr };
  }

  function parseLineAndCount(rawLine) {
    if (!rawLine) return [];
    const names = [];
    const matches = rawLine.match(/\[(.*?)\]/g) || [];
    matches.forEach(m => {
      const name = m.slice(1, -1).trim();
      if (!name || name === '···') return;
      if (!isTargetLang(name)) return;
      names.push(name);
      globalTitleCount.set(name, (globalTitleCount.get(name)||0) + 1);
    });
    return names;
  }
  function namesToTitleList(names) {
    const uniqueOrder = [];
    const seen = new Set();
    names.forEach(name => { if (!seen.has(name)) { seen.add(name); uniqueOrder.push({ name }); } });
    return uniqueOrder;
  }

  // ---------- 合并引擎 ----------
  function generateResult(input) {
    const lines = input.split('\n').filter(l=>l.trim());
    if(!lines.length) return '';
    const mainLine = lines[0];
    const dateMatch = mainLine.match(/(\d{4}年\d{2}月\d{2}日)/)||mainLine.match(/(\d{4}年)/);
    if(!dateMatch) return mainLine;
    const basePart = mainLine.split(dateMatch[0])[0];
    const rest = mainLine.split(dateMatch[0])[1]||'';
    const countMatch = rest.match(/共\d+集/);
    const count = countMatch ? countMatch[0] : '';
    const date = dateMatch[0];
    const baseParts = basePart.split(/[\[\]]+/).filter(p=>p.trim());
    let mainName = baseParts.length ? baseParts[0].trim() : basePart.trim();
    const cnSet=[], tcSet=[], jpSet=[], enSet=[], targetEn=[];

    function classifyAlias(alias) {
      if(alias===mainName||alias==='···') return;
      if(!ALLOW_OTHER_LANGS&&!(isChinese(alias)||isJapanese(alias)||isEnglish(alias))) return;
      const hasCN = isChinese(alias);
      const jp = isJapanese(alias);
      if(hasCN&&!jp){ if(checkChineseType(alias)===0) addUnique(cnSet,alias); else addUnique(tcSet,alias); }
      else if(jp) addUnique(jpSet,alias);
      else if(/^[A-Za-z\s-]+$/.test(alias)) addUnique(enSet,alias);
      else addUnique(enSet,alias);
    }
    baseParts.slice(1).forEach(a=>classifyAlias(a.trim()));
    for(let i=1; i<lines.length; i++){
      const aliases = lines[i].split(/[\[\]]+/).filter(p=>p.trim()).map(p=>p.trim());
      aliases.forEach(alias=>{
        if(!alias||alias===mainName) return;
        if(USE_SECOND_ROW_EN>0&&i===USE_SECOND_ROW_EN){ if(/^[A-Za-z\s-]+$/.test(alias)){ addUnique(targetEn,alias); return; } }
        classifyAlias(alias);
      });
    }
    let finalEn = enSet.filter(e=>targetEn.indexOf(e)===-1).concat(targetEn);
    function unique(arr){ const last={}; arr.forEach((item,idx)=>{last[item]=idx;}); return arr.filter((item,idx)=>last[item]===idx); }
    let allAliases = unique([...cnSet.filter(a=>a!==mainName), ...tcSet.filter(a=>a!==mainName), ...jpSet.filter(a=>a!==mainName), ...finalEn.filter(a=>a!==mainName)]);

    let newMain = mainName;
    const pureZh = cnSet.length?cnSet[0]:(tcSet.length?tcSet[0]:null);
    if(pureZh && isPureChinese(pureZh) && !isPureChinese(mainName)){
      if(isJapanese(mainName)) jpSet.unshift(mainName);
      else if(isEnglish(mainName)) enSet.unshift(mainName);
      newMain = pureZh;
      const idx=cnSet.indexOf(pureZh); if(idx>-1) cnSet.splice(idx,1);
      const idx2=tcSet.indexOf(pureZh); if(idx2>-1) tcSet.splice(idx2,1);
    }
    allAliases = unique([...cnSet.filter(a=>a!==newMain), ...tcSet.filter(a=>a!==newMain), ...jpSet.filter(a=>a!==newMain), ...finalEn.filter(a=>a!==newMain)]);

    const isMainZh = checkChineseType(newMain)===0;
    const isMainJp = isJapanese(newMain);
    const isMainEn = /^[A-Za-z\s-]+$/.test(newMain);

    if(USE_SECOND_ROW_EN>0&&targetEn.indexOf(newMain)!==-1){
      allAliases.push(newMain);
    } else if(isMainJp){
      allAliases.splice(cnSet.length+tcSet.length, 0, newMain);
    } else if(isMainEn){
      if(USE_SECOND_ROW_EN===1 && lines.length>1 && (()=>{ const parts=(lines[1].match(/\[(.*?)\]/g)||[]).map(m=>m.slice(1,-1)); return parts.length?parts[parts.length-1]===newMain:false; })()){
        allAliases.push(newMain);
      } else {
        let jpLast=-1; for(let j=allAliases.length-1;j>=0;j--) if(isJapanese(allAliases[j])){ jpLast=j; break; }
        const enFirst=allAliases.findIndex(a=>/^[A-Za-z\s-]+$/.test(a));
        const pos = jpLast>-1?jpLast+1:(enFirst>-1?enFirst:allAliases.length);
        allAliases.splice(pos,0,newMain);
      }
    } else if(isMainZh && USE_SECOND_ROW_EN>0 && lines.length>1){
      const lastEn = (()=>{ const parts=(lines[1].match(/\[(.*?)\]/g)||[]).map(m=>m.slice(1,-1)); return parts.length?parts[parts.length-1]:''; })();
      if(lastEn && allAliases.indexOf(lastEn)!==allAliases.length-1){
        allAliases.splice(allAliases.indexOf(lastEn),1);
        allAliases.push(lastEn);
      }
    }

    if(isMainZh) return newMain + (allAliases.length?'['+allAliases.join('][')+']':'') + ' ' + date + ' ' + count;
    else return '[' + newMain + (allAliases.length?']['+allAliases.join(']['):'') + '] ' + date + ' ' + count;
  }

  // ---------- AniDB本地数据库 ----------
  const ALLOWED_LANGS_ANIDB = new Set(['ja','en','x-jat','zh-Hans','zh-Hant']);
  const LANG_ORDER = ['zh-Hans','zh-Hant','ja','en','x-jat'];
  async function getAniDBTitlesData(force=false){
    const KEY='anidb_cache_v22';
    if(!force){ const c=localStorage.getItem(KEY); if(c){ try{ const {data,ts}=JSON.parse(c); if(Date.now()-ts<7*864e5) return data; }catch(e){} } }
    const buf=await gmRequest('https://anidb.net/api/anime-titles.dat.gz','arraybuffer',{'Accept-Encoding':'gzip'});
    const ds=new DecompressionStream('gzip');
    const stream=new Response(new Uint8Array(buf)).body.pipeThrough(ds);
    const dec=await new Response(stream).arrayBuffer();
    const text=new TextDecoder('utf-8').decode(dec);
    const titles={};
    text.trim().split('\n').forEach(line=>{ if(line.startsWith('#')) return; const [aid,type,lang,title]=line.split('|'); if(!aid||!title||!ALLOWED_LANGS_ANIDB.has(lang)||+type===3) return; if(!titles[aid]) titles[aid]={}; if(!titles[aid][lang]) titles[aid][lang]=[]; titles[aid][lang].push(title.trim()); });
    try{ localStorage.setItem(KEY, JSON.stringify({data:titles, ts:Date.now()})); }catch(e){}
    return titles;
  }
  function formatAniDBResult(lm){ const col=[]; for(const l of LANG_ORDER){ if(lm[l]) col.push(...lm[l]); } return [...new Set(col)].filter(isTargetLang).map(t=>`[${t}]`).join(''); }
  function findExact(td,ft){ if(!ft) return null; const n=ft.toLowerCase().replace(/[^\w]/g,''); for(const [aid,lm] of Object.entries(td)) if(Object.values(lm).flat().join(' ').toLowerCase().replace(/[^\w]/g,'').includes(n)) return aid; return null; }
  function searchCandidates(td,q){ if(!td||!q) return []; const l=q.toLowerCase().trim(); const cand=[]; for(const [aid,lm] of Object.entries(td)){ let mx=0; for(const lk of Object.keys(lm)) for(const t of lm[lk]){ const tl=t.toLowerCase(); if(tl===l) mx=Math.max(mx,100); else if(tl.includes(l)||l.includes(tl)) mx=Math.max(mx,50); } if(mx>0) cand.push({aid, score:mx, langMap:lm}); } return cand.sort((a,b)=>b.score-a.score); }
  async function fetchAniDB(exactEn, fallbackFrags, seasonKws, bgDate, verifyFrags){
    const data=await getAniDBTitlesData();
    if(exactEn){ const aid=findExact(data,exactEn); if(aid) return formatAniDBResult(data[aid]); }
    const minF=verifyFrags.length>=4?3:2; let best=null;
    const sl=[...new Set([...fallbackFrags,...verifyFrags])];
    for(const q of sl){ const cands=searchCandidates(data,q); for(const c of cands){ const txt=Object.values(c.langMap).flat().join(' ').toLowerCase(); if(verifyFrags.length>=minF && !containsMinFragments(txt,verifyFrags,minF)) continue; let sc=c.score; for(const kw of seasonKws) if(txt.includes(kw.toLowerCase())) sc+=50; if(bgDate&&txt.includes(String(bgDate.year))) sc+=30; if(!best||sc>best.score) best={...c,score:sc}; } if(best) break; }
    if(!best) throw new Error('未找到通过验证的条目');
    return formatAniDBResult(best.langMap);
  }

  // ---------- TMDB ----------
  async function fetchTMDB(exactEn, fallbackFrags, verifyFrags){
    if(!TMDB_API_KEY) throw new Error('未配置 Key');
    const words=[...new Set([exactEn,...fallbackFrags,...verifyFrags].filter(Boolean))];
    for(const q of words){ try{
      const srch=await gmRequest(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=zh-CN&page=1&include_adult=true`,'json');
      if(!srch?.results?.length) continue;
      for(const item of srch.results){
        const detail=await gmRequest(`https://api.themoviedb.org/3/${item.media_type}/${item.id}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles&language=zh-CN`,'json');
        const allText=[detail.name||detail.title||'', detail.original_name||detail.original_title||'', ...(detail.alternative_titles?.results||[]).map(r=>r.title)].filter(Boolean).join(' ').toLowerCase();
        if(exactEn && allText.replace(/[^\w]/g,'').includes(exactEn.toLowerCase().replace(/[^\w]/g,''))){ const set=new Set(); if(detail.name||detail.title) set.add(detail.name||detail.title); if(detail.original_name||detail.original_title) set.add(detail.original_name||detail.original_title); (detail.alternative_titles?.results||[]).forEach(r=>r.title&&set.add(r.title)); return [...set].filter(t=>t&&t.length>1).map(t=>`[${t}]`).join(''); }
        if(verifyFrags.length>=2 && containsMinFragments(allText,verifyFrags,2)){ const set=new Set(); if(detail.name||detail.title) set.add(detail.name||detail.title); if(detail.original_name||detail.original_title) set.add(detail.original_name||detail.original_title); (detail.alternative_titles?.results||[]).forEach(r=>r.title&&set.add(r.title)); return [...set].filter(t=>t&&t.length>1).map(t=>`[${t}]`).join(''); }
      }
    } catch(e){} }
    throw new Error('TMDB 无结果');
  }

  // ---------- MAL ----------
  async function fetchMAL(queries, jpCheck, verifyFrags){
    const list=[...new Set(queries.filter(Boolean))];
    for(const q of list.filter(w=>w.length>5)){ try{
      const data=await gmRequest(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=1`,'json');
      if(!data.data?.[0]) continue;
      const item=data.data[0]; const all=[item.title,item.title_english,item.title_japanese,...(item.title_synonyms||[])].filter(Boolean);
      if(jpCheck&&!all.some(t=>t.includes(jpCheck))) continue;
      return [...new Set(all)].filter(isTargetLang).map(t=>`[${t}]`).join('');
    } catch(e){} }
    if(verifyFrags.length>=2){ for(const q of list){ try{
      const data=await gmRequest(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=1`,'json');
      if(!data.data?.[0]) continue;
      const item=data.data[0]; const all=[item.title,item.title_english,item.title_japanese,...(item.title_synonyms||[])].filter(Boolean);
      const txt=all.join(' ').toLowerCase(); if(!containsMinFragments(txt,verifyFrags,2)) continue;
      if(jpCheck&&!all.some(t=>t.includes(jpCheck))) continue;
      return [...new Set(all)].filter(isTargetLang).map(t=>`[${t}]`).join('');
    } catch(e){} } }
    throw new Error('MAL 无结果');
  }

  // ---------- 主流程 ----------
  async function init() {
    createPanel();
    const searchTitle = $('.nameSingle a').text().trim();
    if (!searchTitle) { addLog('系统', '❌ 未找到搜索标题', false); refreshAllLogs(); return; }
    logCache.length = 0; globalTitleCount.clear();

    const bg = generateBangumiLine();
    const bgNames = bg.allNames;
    bgNames.forEach(name => globalTitleCount.set(name, (globalTitleCount.get(name)||0) + 1));
    addLog('Bangumi', '基础行已生成', true, null, null, namesToTitleList(bgNames), bgNames);

    const bgEnNames = extractEnglishNames(bg.line);
    const bgJpName = extractJapaneseName(bg.line) || null;
    const exactEn = bgEnNames[0] || null;
    const verifyFrags = []; [...bgEnNames, ...extractChineseNames(bg.line), ...(bgJpName?[bgJpName]:[])].forEach(t=>verifyFrags.push(...extractKeyFragments(t)));
    const uniqueFrags = [...new Set(verifyFrags)];
    const fallbackFrags = bgEnNames.length ? extractKeyFragments(bgEnNames[0]) : [];
    const bgDate = extractBangumiDate(bg.line);
    const seasonKws = extractSeasonKeywords(searchTitle, bg.line);
    const requiredKeywords = extractRequiredKeywords(bg.line);

    const $btn = $('#gm-copy-btn');

    const [ani, mal, tmdb] = await Promise.all([
      fetchAniDB(exactEn, fallbackFrags, seasonKws, bgDate, uniqueFrags).then(r => {
        r = filterTitlesByKeywords(r, requiredKeywords);
        if (requiredKeywords.length && !r) throw new Error('无匹配季数条目');
        const names = parseLineAndCount(r);
        addLog('AniDB', '✅', true, r, null, namesToTitleList(names), names);
        return r;
      }).catch(e => { addLog('AniDB', `❌ ${e.message}`, false); return ''; }),
      fetchMAL(bgEnNames.concat(bgJpName||[]), bgJpName, uniqueFrags).then(r => {
        r = filterTitlesByKeywords(r, requiredKeywords);
        if (requiredKeywords.length && !r) throw new Error('无匹配季数条目');
        const names = parseLineAndCount(r);
        addLog('MAL', '✅', true, r, null, namesToTitleList(names), names);
        return r;
      }).catch(e => { addLog('MAL', `❌ ${e.message}`, false); return ''; }),
      fetchTMDB(exactEn, fallbackFrags, uniqueFrags).then(r => {
        r = filterTitlesByKeywords(r, requiredKeywords);
        if (requiredKeywords.length && !r) throw new Error('无匹配季数条目');
        const names = parseLineAndCount(r);
        addLog('TMDB', '✅', true, r, null, namesToTitleList(names), names);
        return r;
      }).catch(e => { addLog('TMDB', `❌ ${e.message}`, false); return ''; })
    ]);

    externalLines = [ani, mal, tmdb];
    const allLines = [bg.line, ...externalLines].filter(l => l);
    finalText = generateResult(allLines.join('\n'));

    refreshAllLogs();

    isReady = true;
    $btn.text('📋 复制 (已就绪)').removeClass('loading').prop('disabled', false);
    updatePreview(finalText);
    if (externalLines.every(l => !l)) {
      const sysMsg = '<div class="log-item"><span class="status-fail">⚠️ 所有外部站点均无数据</span></div>';
      $('#gm-log-area').append(sysMsg);
    }

    $btn.on('click mouseenter', () => { if (finalText) { GM_setClipboard(finalText); showCopyBubble(finalText); } });
    $(document).on('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyC' || e.key === 'c')) {
        if (isReady) { e.preventDefault(); $btn.click(); }
      }
    });
  }

  $(() => setTimeout(init, 500));
})(jQuery);