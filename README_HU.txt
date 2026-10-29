ALLATKAOSZ — ONLINE 2D ALLATOS AKADALYVERSENY
================================================

JAVITASOK EBBEN A VALTOZATBAN (1.10)
---------------------------
- A helyi karakter mozgasa helyben szimulalt; a halozati poziciok nem irjak felul minden frame-ben. Az ugrashoz gombpuffer es peremsegitseg van, a palya/platform utkozesek toleransabbak
- A fizika fix 120 Hz-es lepesekkel fut, az ugrashoz 180 ms-os gombpuffer es 140 ms-os peremsegitseg tartozik; a tavoli karakterek pozicioja simitva jelenik meg
- Leeseskor az avatar azonnal visszakerul a rajtra, a szerverrel egyeztetett ujraelessel
- Halal vagy pajzsos visszalokes utan a kliens a szerver donteset koveti; a csapdaerintes eredmenyet nem probalja elore kitalalni
- A jatekosok a bal oldali rajtplatformon kissé eltolva indulnak, a nevtablakat negy sorban rendezi a jatek
- A TAB-os ponttabla a jatek kozben jelenik meg, a Space nem ugras, a jatek indulasakor a palya fokuszt kap, igy a W azonnal mukodik
- Az epitmenyek a palya lathato reszen platformra, levegobe vagy viz fole is helyezhetok; a zaszlo koruli celzona tiltott, hogy ne lehessen elzarni

A prototipus fo jellemzoi
------------------------
- 2-8 jatekos egy szobaban, szobakoddal
- Malac, kapibara, lo, pingvin es mosomedve karakterek
- 2D oldalnezetes, kozos palya; mindenki egyszerre indul
- Futas es ugras animacioval; forgó furesz es egyeb mozgó/rajzolt csapdak
- A szobagazda allitja a kezdo aranyat, a versenyidot, az epitkezesi idot es a korok szamat; mindenki egy rovid, fix palyan jatszik
- A celba erkezesi sorrend pontokat er; aki az ido lejarataig nem er celba, nem kap helyezesi pontot arra a korre
- A megtett ut kozben aranyat is ad
- Minden kor utan a jatekosok egyenkent epitkeznek, a sorrend koronkent forog; a sajat idon belul tobbszor is vasarolhatnak es epithetnek, amig van aranyuk
- 5 epitmeny: csapdalada, forgo furesz, tuskek, rugos kilovo, gurulo hordo
- Pajzs vasarolhato; egy halalos talalatotol megved, es visszalok
- Egyetlen rovid, fix palya tobb platformmal; az alapcsapdak adottak, a jatekosok epitmenyei a tovabbi korokben is megmaradnak
- Epitmeny platformra, levegobe vagy viz fole is helyezheto; az atatlatszo elo-nezet a lerakas helyen marad. A ladan stabilan meg lehet allni/ugrani, a furesz, tuske es hordo veszelyes
- Teljes kepernyos jatekter, a chat a bal also sarokban, a kor/arany/ido/kilepes a palyan beluli HUD-ban; nincs kulon oldalsav vagy felesleges taska-panel
- Saját targy torlese 8 arany, mas jatekos vagy alap palyaelem torlese 16 arany
- Chat es osszesitett ponttabla
- A karakterek ot kulon vektoros SVG allatsprite-ot hasznalnak ket futolepes-pozicioval; a palya es a csapdak animalt, rajzolt megjelenesuek

INDITAS WINDOWS ALATT
---------------------
1. Csomagold ki a ZIP-et teljesen egy mappaba.
2. Telepitsd a Node.js LTS kiadasat innen: https://nodejs.org/
3. Kattints duplan a start.bat fajlra.
4. Az elso inditaskor az npm letolti az Express es Socket.IO csomagokat; ehhez internet kell.
5. Ha elindult, a bongeszo megnyitja a http://localhost:3000 oldalt.
6. Hozz letre egy szobat, es kuldd el a szobakodot a barataidnak.

HA NEM INDUL EL
---------------
- Ne torold ki a fekete parancsablak tartalmat; a hiba uzenetet masold ki.
- Ha a start.bat azonnal bezarodik, jobb gomb -> Szerkesztes, majd ellenorizd a tartalmat.
- Ha azt irja, hogy a Node.js nem talalhato, telepitsd a Node.js LTS-t, majd nyiss uj CMD ablakot.
- Ha az npm install elakad, ellenorizd az internetkapcsolatot, es inditsd ujra a start.bat fajlt.
- A bongeszoben a Ctrl+F5 frissites segithet, ha regi feluletet latsz.

JATEK MAS SZAMITOGEPROL
-----------------------
Egyazon Wi-Fi/LAN halozaton:
1. A szerver gepen nyiss CMD-t es ird be: ipconfig
2. Keresd meg az aktiv halozati adapter IPv4-cimet (peldaul 192.168.1.60).
3. A masik gepen ezt nyisd meg: http://192.168.1.60:3000
4. Ha nem erheto el, a Windows tuzfal kerdezheti a Node.js engedelyezeset; engedelyezd legalabb a maganhálózaton.

Kulonbozo otthonokbol:
A szervernek internetrol is elerhetonek kell lennie. Ehhez VPS/tarhely vagy megfelelo porttovabbitas es tuzfalbeallitas kell. A localhost cim csak a sajat szamitogepen mukodik.

IRANYITAS
---------
A / Bal nyil: balra
D / Jobb nyil: jobbra
W: ugras (a Space nem ugrik)
TAB: ponttabla es arany megjelenitese (nyomva tartva)
Epitkezeskor: a sorodon belul valassz egy epitmeny-ikont a jobb oldali panelen, mozgassd az egeret a kivant helyre, majd kattints. Tobbszor is epithetsz, amig van aranyad es hatra van az idod; a „Kesz / Kihagyom” gombbal tovabbadhatod a kort. A palya barmely lathato pontjara epithetsz, platformra, levegobe es viz fole is. A kurzor mellett az atatlatszo epitmeny mutatja a lerakas helyet.

MEGJEGYZES
----------
Javitott 1.6 valtozat: rovid, fix palya; TAB-os ponttabla; W billentyus ugras gombpufferrel es peremsegitseggel; fixlepeses fizika; stabil leeses-visszaallas; valodi lada-platform/oldalutkozes; objektum-figura teglalap alapú csapdaerzekeles; szerver altal ellenorzott csapdaeredmeny; epitmeny-elonezet es a celzaszlo koruli tiltott zona. A JavaScript fajlok szintaxisellenorzese sikeres volt, de ebben a letrehozasi kornyezetben az npm csomagok letoltese idotullepes miatt nem fejezodott be, ezert teljes, tobbgepes futtatasi tesztet nem tudtam lefuttatni. Az elso inditaskor a start.bat probalja telepiteni a fuggosegeket.


1.4 FRISSÍTÉS (korábbi)
- A karakterek külön, vektoros SVG állatsprite-okat használnak két mozgó lábpozícióval.
- A visszaszámláló a pályán belül, jól látható helyen van.
- Építkezéskor középen megjelenik, hogy ki van soron.
- A szobagazda a váróteremben beállíthatja az építkezési időt másodpercben.
- Egy játékos egy építkezési körben több tárgyat is lerakhat; a kör a skip gombbal vagy időlejárattal ér véget.


1.4 - UJ JATEKKEZELES (korábbi)
- A jatekosok nagyobb, allatszeru, sajat SVG rajzolt karaktereket kapnak, futaskor ket labpozicioval.
- A verseny- vagy epitkezesi visszaszamlalo a palya feluleten jelenik meg.
- Epitkezesi fazisban nagy kozepso jelzes mutatja, melyik jatekos van soron.
- Az epitkezesi ido a varoteremben, a szobagazda beallitasai kozott allithato (5-180 masodperc).
- Egy epitkezesi turnus alatt tobb epitmeny is lerakhato / pajzs is vasarolhato, amig van arany es idokeret. A turnus a „Kesz / Kihagyom” gombbal vagy az ido lejarataval zarul.


1.6-ÖS JAVÍTÁSOK
- Az építkezési középső üzenet csak a várakozóknak jelenik meg, új építőnél legfeljebb 2 másodpercre.
- A W ugrás magassága változó: rövid nyomás kisebb ugrás, nyomva tartás a korábbi maximális ugrást adja.
- Gazdagabb rajzolt háttér: hegyek, erdő, napfény, felhők, madarak és animált víz.
- Az építmények ütköződobozai alapján nem lehet egymásra pakolni tárgyakat.
- A cél zászlója körül csak egy kis négyzet tiltott építési terület; nem zár el teljes függőleges sávot.

1.6 FRISSÍTÉS
- Építkezési értesítő: a középső üzenet csak a várakozó játékosoknak jelenik meg, és új építőnél 2 másodperc után eltűnik; az aktív építő nem látja.
- Változó ugrásmagasság: rövid W-koppintással kisebb ugrás, nyomva tartással az előző maximális ugrás.
- A pálya háttérgrafikája részletesebb: napfény, rétegzett havas hegyek, zöld dombok, távoli erdő, mozgó felhők, madarak és animált víz.
- Az építmények hitboxai alapján nem lehet egy tárgyat egy másikra helyezni; a kliens előnézete pirossal jelzi a tiltott helyet.
- A zászló körüli tiltott építési zóna kis téglalap, nem teljes magasságú sáv; a szerver ugyanezt ellenőrzi.


ÚJ A 1.6-OS VÁLTOZATBAN
- Négy választható pályavilág: Kezdő mező, Hold, Mars és Város.
- Minden futam előtt közös 3–2–1–MEHET visszaszámlálás. Az 5/5 (vagy beállított utolsó) kör külön feliratot kap: UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK!
- Kisebb állatkarakterek, gyorsabb mozgásanimáció és kisebb fizikai ütközési doboz.
- A háttér pályavilágonként egyszer renderelődik és gyorsítótárból rajzolódik, így csökken a képkockánkénti terhelés.
- A pályák platformelrendezése témánként is változik.

A 1.6-os változatban a szobagazda 4 pályavilágból választhat: Kezdő mező, Hold, Mars, Város. A világok saját háttérrel és módosított platformelrendezéssel rendelkeznek. Minden futam 3–2–1–MEHET visszaszámlálással indul, az utolsó körben pedig külön 'UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK!' jelzés jelenik meg.


1.8-AS FRISSÍTÉS
- Négy választható világ: Kezdő mező, Hold, Mars, Város; a világok eltérő hátteret és platformmagasságokat használnak.
- A futam 3–2–1–MEHET visszaszámlálással indul; az utolsó kör külön, feltűnő üzenetet kap.
- Kisebb rajzolt állatkarakterek és szűkebb fizikai hitbox; lendületesebb lábanimáció, enyhe squash/bob mozgással.
- A HUD frissítése ritkábban módosítja a DOM-ot, a statikus hátterek gyorsítótárból rajzolódnak a terhelés csökkentésére.
- Plusz segítségek vásárolhatók: Mentőöv (egy esésnél visszatesz az előző platformra) és Ugrócsizma (a következő ugrást magasítja), a pajzs mellett.

1.8-AS FRISSÍTÉS – RÉSZLETEK
- Négy pályavilág a váróteremben: Kezdő mező, Hold, Mars, Város. Mindegyik saját háttérrel és platformelrendezéssel rendelkezik.
- Közös 3–2–1–MEHET visszaszámlálás; az utolsó körben nagy, feltűnő 'UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK!' jelzés.
- Kisebb karakterrajz és keskenyebb fizikai hitbox, futáskor váltakozó lábpozícióval, rugózó mozgással.
- Kisebb kliensoldali terhelés: a háttér gyorsítótárazott, a HUD nem írja újra a DOM-ot minden hálózati pozíciócsomagnál.
- Plusz segítségek építkezéskor: Pajzs (egy csapdát kivéd), Mentőöv (egyszer visszatesz az előző platformra eséskor), Ugrócsizma (a következő ugrást magasabbra teszi).
- A zászló körüli építésmentes téglalap kissé nagyobb, de továbbra sem zárja el az egész függőleges sávot.


1.8-AS FRISSÍTÉS – ÚJDONSÁGOK
---------------------------
- A futási sebesség jelentősen lassabb (a helyi karakter 155 pályaegység/másodperc sebességgel mozog).
- A karakterek nagyobb, 60x60-as rajzolt SVG-sprite-tal láthatók, a két lépésfázis lassabb ütemben váltakozik, a névtábla a nagyobb sprite-hoz igazodik.
- A W ugrás változó magasságú: rövid megnyomásra alacsony ugrás, nyomva tartva fokozatosan magasabb; a Space továbbra sem ugrik.
- A rajtnál egy védett téglalap van (x=0–260), ahová nem lehet építeni vagy tárgyat áthelyezni. A cél körüli védett mező szintén megmarad.
- Új építkezési műveletek: pályán lévő objektum törlése 8 aranyért, illetve áthelyezése 12 aranyért. Az alap pályaobjektumok is módosíthatók; minden művelethez megfelelő arany és nem védett, üres célpont szükséges.
- A tárgymozgatás két kattintásos: válaszd a Mozgatást, kattints az áthelyezendő objektumra, majd kattints az új helyére. A törlésnél a Törlés eszköz kiválasztása után a törlendő objektumra kell kattintani. Saját tárgy törlése 8 arany, más játékos vagy alap pályaelem törlése 16 arany.
- Az új védett rajtzóna az építkezési fázisban zöld színnel, a célzóna pirossal látszik.

FONTOS: A törlés és áthelyezés műveleteihez a játékos építkezési köre és a megfelelő aranymennyiség szükséges.


1.9-AS FRISSÍTÉS – CÉLBA ÉRÉS, ÁLLATSPRITE-OK ÉS OBJEKTUMTÖRLÉS
- A célba érő játékosok a chatben helyezést, pontjutalmat és aranyjutalmat kapnak kiírva; az első helyezett külön kiemelt üzenetet kap.
- Frissített, részletesebb, két futó pózt tartalmazó SVG állatgrafikák: malac, kapibara, ló, pingvin és mosómedve.
- Építkezési fázisban a pálya tárgyainak listájában mindegyik mellett külön Törlés gomb van. A beépített pályaelemek is törölhetők; mivel nem a játékos saját tárgyai, a művelet 16 aranyba kerül. A pályán kattintással történő törlés is megmaradt.
- A törlés és mozgatás kijelölése elnézőbb kattintási területet kapott.
- A rajt és a cél körüli építésmentes zóna látható védelmet kap.


1.10 — TELJES KÉPERNYOS JATEKKEPERNYO
-----------------------------------
- A játék teljes ablakot kitöltő nézetet kap; a weboldal felső sávja játék közben eltűnik.
- A kör, az arany, az idő, a kapcsolat állapota, a súgó, a teljes képernyő és a kilépés a játék HUD-jában van.
- A chat keretes panelként a bal alsó sarokba került, az építkezési panel pedig csak az építkezési fázisban jelenik meg a jobb alsó sarokban.
- A külön táska-panel kikerült a játékképernyőről, így több látszik a pályából.
- A célba érkezési és jutalomüzenetek a játékbeli chatben maradnak.
- Saját építmény törlése 8 arany, más játékos vagy alap pályaelem törlése 16 arany. A szerver ellenőrzi a tényleges költséget is.
- A HUD teljes képernyő gombja böngészőszintű teljes képernyőt kér; a játék alapból is a teljes böngészőablakot kitölti.

1.11-ES FRISSÍTÉS
-----------------
- Építkezéskor a teljes pálya áttekintéséhez a rajzolás 82%-os nagyításban jelenik meg; az egérhelyet a játék visszaszámolja a pálya koordinátáira, ezért az építés, törlés és mozgatás továbbra is a kurzorhoz igazodik.
- A chat kisebb lett és a fejlécén lévő +/− gombbal összecsukható. Az összecsukott állapot a játék fázisváltásánál is megmarad.
- Célba éréskor a chat továbbra is kiírja a helyezést, pontot és aranyat, és egy néhány másodpercig látható, külön játékbeli jutalomértesítés is megjelenik. Az első helyezett külön kiemelést kap.
