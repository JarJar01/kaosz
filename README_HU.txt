ÁLLATKÁOSZ 1.15.1 – TELJES JÁTÉK ÉS MAGYAR ÚTMUTATÓ
===================================================

MI VAN A CSOMAGBAN?
- A teljes HTML/CSS/JavaScript játék, Node.js szerver és az öt állat SVG/PNG sprite-csomagja.
- Online szobák 2–8 játékosnak, állatválasztás, név, kupamentés a szerveren név szerint.
- Négy világ: Kezdő mező, Hold, Mars és Város; minden új versenyben változó köztes platformelrendezéssel.
- Építkezés aranyért: láda, fa lépcső, fa létra, váltakozó tüskés láda, rugós kilövő, díszes fahordó, szélfújó ventilátor és leeső jégcsap.
- Segítségek: pajzs, mentőöv és ugrócsizma.
- A hordó szilárd, rá lehet ugrani, nem öl és nem lök el.
- A tüskés láda balra, jobbra és felfelé szúr; a vizuális animáció és a veszélyes ütközési terület össze van hangolva.
- A létra külön építmény a lépcsőtől: mellette a W nyomva tartásával lehet felmászni.
- A ventilátor forgó lapátokkal és látható légárammal működik; légárama enyhén jobbra fúj.
- A jégcsap felülről esik le. Először látható zuhanás történik, majd a játékos csak akkor kap találatot, ha az ütközés pillanatában még alatta van. Pajzs megvédhet tőle.
- A játékos rá tud érkezni a ládák, hordó, ventilátor, rugós kilövő és lépcső szilárd felületére; a létra külön mászható.
- A rajt és a cél körül építésmentes védett zóna van.
- Saját objektum törlése 50 arany; más játékos vagy beépített pályaelem törlése 100 arany. Mozgatás 12 arany.
- Az 5/5-ös (vagy a beállított utolsó) versenykör után közvetlenül eredményhirdetés következik.

INDÍTÁS WINDOWS ALATT
1. Csomagold ki a ZIP-et egy mappába.
2. Ha még nincs telepítve, telepítsd a Node.js LTS-t: https://nodejs.org/
3. Kattints duplán a start.bat fájlra. Első indításkor a szükséges npm-csomagok települnek; ehhez internetkapcsolat kell.
4. A böngészőben nyisd meg: http://localhost:3000
5. Hozz létre szobát, válassz állatot és küldd el a meghívókódot a barátoknak.

VEZÉRLÉS
- A/D vagy bal/jobb nyíl: mozgás.
- W: ugrás; rövid nyomásra alacsonyabb, nyomva tartva magasabb ugrás. A létra mellett W-vel fel lehet mászni.
- Space: nem ugrik.
- TAB: pontok és arany megtekintése.
- Építkezéskor a felső ikonsorból válassz tárgyat, majd kattints a pályára.
- Törlés: saját tárgy 50, más játékosé vagy pályaelem 100 arany. Mozgatás: 12 arany.
- A ventilátor légárama jobbra fújhat; a hordó nem lök el.

ONLINE JÁTÉK
- Egyazon Wi-Fi/LAN hálózaton a többiek a szervert futtató gép helyi IP-címével és a 3000-es porttal csatlakozhatnak.
- Különböző otthonokból nyilvánosan elérhető szerver vagy megfelelő hálózati beállítás szükséges.

KUPÁK MENTÉSE
A kupák a játékos nevét használva a szerver mappájának data/player_cups.json fájljába mentődnek. Frissítésnél őrizd meg ezt a fájlt. Két azonos név ugyanahhoz a kupaálláshoz tartozik.

HIBAELHÁRÍTÁS
Ha a start.bat hibát jelez, ne zárd be a fekete ablakot: másold ki a hibaüzenetet.

Megjegyzés: a JavaScript szintaxisát és a ZIP épségét ellenőriztük, de ez nem helyettesíti a teljes több számítógépes hálózati tesztet.

GRAFIKA
Az assets/animals mappában vannak az állatok álló, futó, ugró és eső sprite-jai. Ezek az eredeti, projekthez készített grafikai fájlok; nem Vecteezy-letöltések.
