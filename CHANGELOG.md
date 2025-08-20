
# Update: Auto-bots + Paused Timers + Overlay fix + Slower naval

- **Bots automatisch gespawned** bij start (`startFromMenu`), aantal op basis van landgrootte (`~0.5%` van tiles, min 20/max 80).
- **Timers gepauzeerd** tot je **eerste spawn**: economie (income + interest) en bot AI draaien pas na jouw eerste tile.
- **Loop geforceerd gestart** bij start (maar gepauzeerd), zodat overlay/UI al zichtbaar zijn.
- **Overlay-dubbeltekening opgelost**: overlay wordt **elk frame hertekend** om stacking te voorkomen.
- **Varende pixel trager**: default van 18 → **6** tiles/sec.
