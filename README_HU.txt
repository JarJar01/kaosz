ALLATKAOSZ — ONLINE 2D ALLATOS AKADALYVERSENY
================================================

JAVITASOK EBBEN A VALTOZATBAN (1.3)
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
- A szobagazda allitja a kezdo aranyat, a koridot es a korok szamat; mindenki egy rovid, fix palyan jatszik
- A celba erkezesi sorrend pontokat er; aki az ido lejarataig nem er celba, nem kap helyezesi pontot arra a korre
- A megtett ut kozben aranyat is ad
- Minden kor utan a jatekosok egyenkent epitkeznek, a sorrend koronkent forog
- 5 epitmeny: csapdalada, forgo furesz, tuskek, rugos kilovo, gurulo hordo
- Pajzs vasarolhato; egy halalos talalatotol megved, es visszalok
- Egyetlen rovid, fix palya tobb platformmal; az alapcsapdak adottak, a jatekosok epitmenyei a tovabbi korokben is megmaradnak
- Epitmeny platformra, levegobe vagy viz fole is helyezheto; az atatlatszo elo-nezet a lerakas helyen marad. A ladan stabilan meg lehet allni/ugrani, a furesz, tuske es hordo veszelyes
- Chat es osszesitett ponttabla
- A menu grafikaval, a karakterek es a palya pedig animalt, rajzolt megjelenessel keszulnek

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
2. Keresd meg az aktiv halozati adapter IPv4-cimet (peldaul 192.168.1.50).
3. A masik gepen ezt nyisd meg: http://192.168.1.50:3000
4. Ha nem erheto el, a Windows tuzfal kerdezheti a Node.js engedelyezeset; engedelyezd legalabb a maganhálózaton.

Kulonbozo otthonokbol:
A szervernek internetrol is elerhetonek kell lennie. Ehhez VPS/tarhely vagy megfelelo porttovabbitas es tuzfalbeallitas kell. A localhost cim csak a sajat szamitogepen mukodik.

IRANYITAS
---------
A / Bal nyil: balra
D / Jobb nyil: jobbra
W: ugras (a Space nem ugrik)
TAB: ponttabla es arany megjelenitese (nyomva tartva)
Epitkezeskor: valassz egy epitmeny-ikont a jobb oldali panelen, mozgassd az egeret a kivant helyre, majd kattints. A palya barmely lathato pontjara epithetsz, platformra, levegobe es viz fole is. A kurzor mellett az atatlatszo epitmeny mutatja a lerakas helyet.

MEGJEGYZES
----------
Javitott 1.3 valtozat: rovid, fix palya; TAB-os ponttabla; W billentyus ugras gombpufferrel es peremsegitseggel; fixlepeses fizika; stabil leeses-visszaallas; valodi lada-platform/oldalutkozes; objektum-figura teglalap alapú csapdaerzekeles; szerver altal ellenorzott csapdaeredmeny; epitmeny-elonezet es a celzaszlo koruli tiltott zona. A JavaScript fajlok szintaxisellenorzese sikeres volt, de ebben a letrehozasi kornyezetben az npm csomagok letoltese idotullepes miatt nem fejezodott be, ezert teljes, tobbgepes futtatasi tesztet nem tudtam lefuttatni. Az elso inditaskor a start.bat probalja telepiteni a fuggosegeket.
