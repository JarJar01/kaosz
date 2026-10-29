ÁLLATKÁOSZ 1.13 – MAGYAR INDÍTÁSI ÉS JÁTÉKÚTMUTATÓ
=================================================

MI ÚJ EBEN A VÁLTOZATBAN?
- A malac, kapibara, ló és mosómedve felismerhetőbb, négy lábú vektoros karaktert kapott; a pingvin két lábbal jelenik meg. Futás közben két eltérő lábpozíció között váltanak.
- Minden új versenyben a köztes platformok helye, szélessége és magassága véletlenszerűen változik. A rajt és a célplatform stabilan megmarad.
- Saját építmény törlése 50 arany; más játékos építményének vagy beépített pályaelem törlése 100 arany.
- A forgó fűrész kikerült a játékból. Van helyette fa lépcső, váltakozó oldalon előugró és visszahúzódó tüskés láda, valamint hordó.
- A hordó nem öl: meglöki a játékost és rövid időre megtorpanásra kényszeríti.
- Az utolsó kör (például 5/5) után közvetlenül eredményhirdetés következik; nem indul utolsó építkezési fázis.
- A verseny győztese egy kupát kap. A kupák a szerveren, játékosnév alapján mentődnek a data/player_cups.json fájlba.

INDÍTÁS WINDOWS ALATT
1. Csomagold ki a ZIP-et egy mappába.
2. Telepítsd a Node.js LTS-t innen: https://nodejs.org/ – ha már telepítve van, ezt a lépést kihagyhatod.
3. Kattints duplán a start.bat fájlra. Az első indításkor az npm telepíti az Express és Socket.IO függőségeket, ehhez internetkapcsolat szükséges.
4. A böngészőben nyisd meg: http://localhost:3000
5. Hozz létre egy szobát, válassz állatot, majd küldd el a meghívókódot a barátoknak.

ONLINE CSATLAKOZÁS
- Ugyanazon Wi-Fi/LAN hálózaton a többiek a szervert futtató gép helyi IP-címével és a 3000-es porttal csatlakozhatnak.
- Különböző otthonokból nyilvánosan elérhető szerver vagy más megfelelő hálózati megoldás szükséges.

VEZÉRLÉS
- A/D vagy bal/jobb nyíl: mozgás.
- W: ugrás. Rövid megnyomásra kicsit ugrasz, nyomva tartva magasabbra. A Space nem ugrik.
- TAB: pontok és arany megtekintése.
- Építkezéskor a felső ikonsorból válassz tárgyat, majd kattints a pályára.
- Törlés: saját tárgy 50, más játékosé vagy pályaelem 100 arany. Mozgatás: 12 arany.
- Nem lehet két tárgyat egymásra pakolni; a rajt és a cél körüli kis védett zónákba nem lehet építeni.
- Az építkezési köröd alatt több tárgyat is vehetsz, amíg van aranyad és időd; a „Kész / Kihagyom” gombbal hamarabb továbbadhatod a kört.

KUPÁK MENTÉSE
A kupaállás név alapján a szerver mappájában található data/player_cups.json fájlba mentődik. Ha a kupákat meg akarod őrizni szerverfrissítés után is, őrizd meg ezt a data mappát. Két azonos játékosnév ugyanazt a kupaállást használja.

HIBAELHÁRÍTÁS
Ha a start.bat hibát jelez, ne zárd be a fekete ablakot: másold ki a hibaüzenetet, és az alapján meg lehet keresni a problémát.

Megjegyzés: a JavaScript szintaxisellenőrzése és a ZIP-ellenőrzés önmagában nem helyettesíti a több számítógépes, valódi hálózati tesztet. Első körben próbáljátok ki két böngészőből.
