# Kit de lancement — Rate This Car

Ce document est pour toi : ce qu'il faut faire avant de lancer, où publier, dans quel ordre, et des textes prêts à adapter.

Je n'ai rien publié moi-même, pour trois raisons :
- Poster sur Reddit, Hacker News, Product Hunt ou V2EX demande **ton** compte.
- Ces communautés exigent que l'auteur se présente comme tel.
- Surtout, il reste une vérification juridique à faire avant d'annoncer l'app publiquement (section 1).

---

## 1. ⚠️ À faire avant toute annonce publique : le point juridique

Ce qui ressort de mes recherches (septembre 2026). Je ne suis pas avocat, ce n'est pas un avis juridique.

- **Une plaque est une donnée personnelle.** La CNIL le dit explicitement. Elle déconseille aux particuliers de publier une plaque non floutée, surtout « pour dénoncer le comportement d'un automobiliste ».
- **Précédent direct en Allemagne.** L'autorité de protection des données a interdit à *fahrerbewertung.de* d'afficher publiquement les notes liées à une plaque. La décision a été confirmée par la justice : VG Köln (février 2017), puis OVG NRW 16 A 770/17 (octobre 2017). Seul le titulaire du véhicule pouvait encore voir ses notes. Ces décisions sont antérieures au RGPD, mais le raisonnement devrait rester le même.
- **Précédent en France.** En 2008, le site Note2be, qui notait des enseignants, a été suspendu par la justice. La CNIL a jugé illégitime le fait de noter des personnes identifiables sans leur accord.
- **Article 10 du RGPD.** Des tags comme « a grillé un feu rouge » allèguent des infractions. Or le traitement de données relatives aux infractions est très encadré.
- **Diffamation (loi de 1881).** L'hébergeur devient responsable s'il ne retire pas un contenu manifestement illicite après signalement. Tu es cet hébergeur.
- **Le RGPD s'applique à toi**, car tu es établi en France, même si les utilisateurs sont en Inde ou aux États-Unis. Viser d'autres pays ne supprime donc pas le risque.
- **Chine.** Les règles de 2021 sur les données automobiles classent les images extérieures montrant des plaques comme « données importantes ».
- **Inde.** Un recours est en cours devant la Haute Cour de Delhi contre les apps qui exposent les propriétaires via leur plaque.

**Ce que l'app fait déjà pour limiter le risque :**
- Les plaques sont stockées hachées : aucune liste de plaques n'existe dans la base.
- Aucun compte, aucune photo, aucune position n'est conservé.
- Les hachés d'IP et d'appareil sont effacés après 48 h.
- Les notes sont supprimées après 12 mois.
- Il n'y a pas de classement public ni de « pires conducteurs ».
- Les commentaires contenant un lien, un e-mail ou un téléphone sont refusés.
- Un bouton « Signaler » masque une note après 3 signalements.
- Une API de modération permet de supprimer une note ou toutes les notes d'une plaque.

**Ce qu'il te reste à faire :**
1. **Consulter un avocat** spécialisé RGPD / droit du numérique (quelques centaines d'euros bien investis), ou au minimum lire le guide RGPD de la CNIL pour les développeurs.
   - Deux questions à lui poser :
     - L'affichage public des notes est-il défendable ?
     - Faut-il passer à un mode où seules les stats agrégées sont visibles ?
   - Je peux adapter l'app dans un sens ou dans l'autre.
2. **Mentions légales** (obligatoires en France, LCEN) : ton identité et ton hébergeur (Cloudflare). Il faut aussi une vraie **politique de confidentialité** : finalités, base légale, durées, droits. L'écran « À propos » en est une base.
3. **E-mail de contact** pour les demandes de retrait : `CONTACT_EMAIL` dans `wrangler.jsonc`.
4. **Activer la modération** : `npx wrangler secret put ADMIN_TOKEN`. Traite les demandes vite, c'est ce qui te protège en tant qu'hébergeur.

---

## 2. Checklist technique

- [ ] **Déployer.**
  - Bouton « Deploy to Cloudflare » du README : compte Cloudflare gratuit, environ 2 minutes.
  - Ou en ligne de commande : `npm install && npx wrangler login && npm run deploy`.
- [ ] **Tester sur ton téléphone** (Android + iPhone si possible) : photo réelle d'une voiture garée, notation, « Ajouter à l'écran d'accueil ».
- [ ] **Nom de domaine propre** (≈ 10 €/an), par exemple `ratethiscar.app`. Je n'ai pas pu vérifier qu'il est libre.
  - Pourquoi :
    - BetaList refuse les sous-domaines gratuits (`*.workers.dev`).
    - `*.workers.dev` est souvent bloqué en Chine continentale.
    - Ça inspire plus confiance.
- [ ] Remplir `CONTACT_EMAIL`, puis définir `ADMIN_TOKEN`.
- [ ] Activer **Cloudflare Web Analytics** : gratuit, sans cookie, pour mesurer les visites.
- [ ] **Préparer les visuels.** `docs/screenshots*.png` existent en 5 langues, avec la plaque fictive « DEMO 42 ». Pour une vidéo : **plaques et visages floutés**, et filmer **en passager ou à l'arrêt**.

> Note sur le nom : #RateThisCar sur TikTok sert à noter des *modèles* de voitures. Le slogan « Notez le conducteur devant vous » lève l'ambiguïté. Garde-le toujours avec le nom.

---

## 3. Où publier, et à quelles conditions

Règles relevées fin septembre 2026. Reddit bloque les robots, donc **relis les règles de chaque subreddit** (`old.reddit.com/r/NOM/about/rules`) avant de poster.

| Canal | Autopromo ? | Conditions principales |
|---|---|---|
| r/SideProject (~800k) | Oui | Ton propre projet, produit fonctionnel, flair. Les comptes sans historique sont filtrés. |
| r/webdev (~3,3M) | Samedi seulement | Flair « Showoff Saturday », rien de commercial. |
| r/IMadeThis (~33k) | Oui | Une fois par projet. |
| r/alphaandbetausers (~39k) | Oui | Flair [Beta], dire quel retour tu veux. Environ 1 post par mois. |
| r/roastmystartup (~22k) | Oui | Critiques franches garanties. |
| r/indiehackers (~117k) | Oui | Flair « SHOW IH », un post par produit, demander des retours. |
| r/coolgithubprojects (~117k) | Oui | Code sur GitHub, pas de repost avant 6 mois. |
| r/developersIndia (~1,6M) | Mégathread | « Showcase Sunday », le 2e dimanche du mois (**11 octobre**). |
| r/InternetIsBeautiful (~16,6M) | Rarement | Pas de compte fait pour l'autopromo (environ 90 % d'activité sans lien avec ton site), pas d'inscription requise. |
| r/IdiotsInCars, r/Roadcam, r/france, r/AskFrance, r/india, r/spain, r/mexico… | Probablement non | Subs de contenu : ne poste pas de lien. Si quelqu'un demande « ça existe une app pour… ? », réponds en disant que c'est toi qui l'as faite. |
| Hacker News (Show HN) | Oui | Doit être essayable sans inscription (c'est le cas). **Depuis 2026, les nouveaux comptes ne peuvent pas poster de Show HN.** Les commentaires écrits ou retouchés par une IA sont interdits : écris le tien toi-même. |
| Product Hunt | Oui | Lancement de 00:01 à 23:59 heure du Pacifique. Mardi ou mercredi conseillé. Ne pas mendier de votes, répondre à chaque commentaire. |
| BetaList | Oui | Domaine propre obligatoire. File gratuite de plusieurs semaines, ou 129 $ pour accélérer. |
| V2EX, nœud 分享创造 | Oui | Les développeurs indépendants y sont bienvenus. Un lien GitHub = partage sincère. Sinon le post est déplacé vers 推广. |
| 小红书 | Sans lien | Liens, QR codes et contacts sont considérés comme du 导流 (détournement de trafic). Poste en tant que développeur et fais chercher le nom de l'app. |
| 即刻 | Oui | Cercles 独立开发的日常, 产品安利社. |
| HelloGitHub / hebdo de 阮一峰 | Oui | Soumission par issue GitHub. HelloGitHub publie le 28 de chaque mois, 阮一峰 le vendredi. |

**Règles d'or :**
- Ne jamais coller le même texte partout. Espacer les posts Reddit d'au moins 24 h.
- Toujours dire que tu es le créateur, et répondre à chaque commentaire.
- **Jamais** de faux comptes, de votes achetés ni de fausses notes pour « amorcer » l'app.

---

## 4. Calendrier proposé

À décaler selon le point juridique : ne commence pas avant.

| Quand | Quoi |
|---|---|
| **Avant le J1** | Déploiement, domaine, mentions légales, avis juridique. Soumettre à BetaList, HelloGitHub, 阮一峰. Programmer le lancement Product Hunt. Participer normalement à HN et Reddit pour avoir un historique. |
| **J1 — mardi 6 oct.** | r/SideProject |
| **J2 — mercredi 7 oct.** | V2EX 分享创造, 即刻 |
| **J3 — jeudi 8 oct.** | r/alphaandbetausers |
| **J4 — vendredi 9 oct.** | r/roastmystartup (demande-leur de démolir ton modèle vie privée / anti-abus) |
| **J5 — samedi 10 oct.** | r/webdev, Showoff Saturday |
| **J6 — dimanche 11 oct.** | Commentaire dans le Showcase Sunday de r/developersIndia |
| **J8 — mardi 13 oct.** | Product Hunt (00:01 heure du Pacifique = 9 h 01 à Paris) |
| **J9–J10** | Show HN (si ton compte le permet), récit sur Indie Hackers |
| **J12 et après** | r/IMadeThis, r/coolgithubprojects, r/InternetIsBeautiful (si l'app est stable), vidéos courtes (environ 3 par semaine) |

---

## 5. Textes prêts à adapter

Remplace `<URL>` par l'adresse de l'app et `<GITHUB>` par le lien du code. **Personnalise-les** avec tes mots : une anecdote vraie (le jour où quelqu'un a jeté une canette devant toi…) marche mieux que tout.

### r/SideProject (anglais)

**Title:** I built a web app to rate the driver in front of you: snap the car, the plate is read on your phone, give stars (no account, no app store)

> Ever been stuck behind someone throwing trash out of the window, or texting at 90 km/h, and wished you could… rate them? So I built **Rate This Car**: <URL>
>
> - Take a photo (as a passenger!). The plate is detected and read **on your phone**: a YOLOv9 detector plus an OCR model running in WebAssembly. The photo is never uploaded.
> - Give 1–5 stars and quick comments ("dangerous driving", "throws litter out of the window", or "courteous").
> - Look up any plate to see how it drives.
> - No account, no install (it's a PWA), 5 languages: EN, 中文, हिन्दी, ES, FR.
> - No car around? There's a sample photo so you can try it from your desk.
>
> Privacy was my biggest worry:
> - plates are stored hashed;
> - no photos or locations are kept;
> - anti-abuse hashes are wiped after 48 h and ratings expire after a year;
> - there are no "worst drivers" rankings;
> - a report button hides abusive ratings.
>
> I'd love feedback:
> 1. Does it read *your* country's plates correctly?
> 2. Would you use it, or is it too Black Mirror?
> 3. Anything confusing in the flow?
>
> Open source (MIT): <GITHUB>

### r/webdev — Showoff Saturday (anglais, angle technique)

**Title:** [Showoff Saturday] License plate recognition running entirely in the browser: YOLOv9 + OCR on onnxruntime-web, 92% exact reads, no build step

> Side project: <URL> (a PWA to rate the driver in front of you). The fun part was the ALPR running client-side:
>
> - **Detector:** YOLOv9-t (384 px, end-to-end with NMS) from open-image-models, 7.6 MB, fp32. int8 quantization cost 2–3 points of accuracy, so I kept fp32.
> - **OCR:** fast-plate-ocr `cct-s-v2`, quantized to int8 (5.1 MB → 1.8 MB) with no accuracy loss. It also predicts the plate's country, which I use to switch the country automatically.
> - **Runtime:** onnxruntime-web (wasm). COOP/COEP headers make the page cross-origin isolated, which enables multi-threaded wasm: about 120 ms per photo versus about 270 ms single-threaded (desktop Chromium).
> - **Accuracy:** 92.3% exact plate reads on the OpenALPR end-to-end benchmark (444 photos, EU/US/BR). The browser results match the Python reference on 429 of 444 photos; the differences come from canvas resizing.
> - **Stack:** vanilla JS modules with no bundler, a service worker that caches the ~13 MB of model and runtime after the first use, a Cloudflare Worker + D1 backend, plates stored as HMACs.
>
> Curious how fast it runs on your phone (there's a sample photo on the home screen). Code: <GITHUB>

### Show HN (anglais) — **écris le texte toi-même**, voici seulement les points clés

- Titre suggéré : `Show HN: Rate This Car – rate the driver in front of you, plates read on-device`
- Pourquoi tu l'as fait : une anecdote vraie.
- Comment ça marche : plaque lue sur l'appareil, rien d'uploadé, 92 % sur le benchmark OpenALPR.
- **Aborde la vie privée d'emblée** (ce sera LE sujet des commentaires) : hachage, pas de classement, expiration, signalement, et ce que tu as appris des échecs passés (fahrerbewertung.de, Nexar, Peeple).
- Question ouverte à la communauté : « Comment rendre ça utile sans que ça devienne un outil de harcèlement ? »

### Product Hunt

- **Nom :** Rate This Car
- **Tagline (60 car. max) :** `Rate the driver in front of you. Plate read on-device`
- **Description :** `Snap the car in front of you (as a passenger!), the licence plate is read right on your phone, then give the driver 1–5 stars and quick comments. No account, no app store, 5 languages. Photos never leave your phone and plates are stored hashed.`
- **Topics :** Web App, Privacy, Open Source, Artificial Intelligence
- **Premier commentaire (le tien) :** ton histoire, ce qui est original (lecture sur l'appareil, sans compte), la démarche vie privée, et une question précise pour la communauté.

### Réseaux français : LinkedIn, X, groupes Facebook, r/france **seulement si les règles l'autorisent**

> 🚗⭐ J'ai créé **Rate This Car** : vous photographiez la voiture devant vous (en tant que passager !), la plaque est lue **directement sur le téléphone**, et vous notez le conducteur de 1 à 5 étoiles avec des commentaires rapides : « conduite dangereuse », « jette des déchets par la fenêtre »… ou « courtois ».
>
> Sans compte, sans passer par un store : ça marche depuis un simple lien, en 5 langues → <URL>
>
> La photo ne quitte jamais votre téléphone, les plaques sont stockées de façon brouillée, et les notes s'effacent au bout d'un an.
>
> Je cherche des retours : la lecture de plaque marche-t-elle chez vous ? Qu'est-ce qui vous gênerait ?

### V2EX — 分享创造 (chinois)

**标题：** [开源] Rate This Car：拍下前车，手机本地识别车牌，给司机打星（免注册、无需安装）

> 做了一个小工具：<URL>
>
> - 乘客拍下前车，**车牌在手机浏览器里本地识别**，照片不上传。
>   - 技术：YOLOv9 车牌检测 + fast-plate-ocr，跑在 onnxruntime-web / WebAssembly 上。
>   - 在 OpenALPR 基准上完整车牌识别准确率 92%。
> - 1–5 星 + 快捷评价（危险驾驶、往窗外扔垃圾、礼让行人……），任何人都能查某个车牌的评分。
> - 免注册、PWA 可添加到主屏幕，支持中文 / English / हिन्दी / Español / Français。
> - 隐私：车牌只存 HMAC 哈希；不存照片和位置；防滥用哈希 48 小时后删除；评分一年后自动删除；没有“最差司机”排行榜。
> - 限制：OCR 目前只识别字母和数字，中国车牌的省份汉字需要手动补上。
>
> 后端是 Cloudflare Workers + D1，前端无构建步骤。代码（MIT）：<GITHUB>
>
> 欢迎拍砖，特别想听听大家对隐私设计的意见。

### 小红书（chinois — **pas de lien**, fais chercher le nom）

> 🚗⭐ 独立开发了一个小网页应用：Rate This Car
>
> 坐在副驾时遇到往窗外扔垃圾、开车玩手机的司机，拍一下前车，车牌会在手机上自动识别（照片不上传！），然后给司机打星、选“危险驾驶”“往窗外扔垃圾”或者“礼让行人”👍
>
> 不用注册，不用下载，支持中文。浏览器搜索「Rate This Car」就能用～
>
> ⚠️ 开车时千万别用手机，请让乘客来拍！
>
> #独立开发 #文明驾驶 #路怒症 #开车 #小工具

### r/developersIndia — Showcase Sunday (anglais, **en commentaire dans le mégathread**)

> **Rate This Car** — rate the driver in front of you. Snap the car, and the plate is read on-device in the browser (YOLOv9 + OCR on onnxruntime-web).
>
> - No login, PWA, and a full Hindi UI.
> - Stack: vanilla JS, a Cloudflare Worker + D1 backend, plates stored as HMACs.
> - Biggest challenges:
>   - multi-threaded wasm, which needs COOP/COEP headers;
>   - keeping the model download to about 13 MB;
>   - fair rate limits behind carrier-grade NAT.
> - **Help wanted:** the OCR model wasn't trained on Indian plates. Does it read yours (e.g. `MH 12 AB 1234`)?
>
> <URL> · <GITHUB>

### Hindi : WhatsApp, X, ShareChat

> 🚗⭐ अपने आगे चल रहे ड्राइवर को रेटिंग दें!
>
> कार की फ़ोटो लें। नंबर प्लेट आपके फ़ोन पर ही पढ़ी जाती है, फ़ोटो अपलोड नहीं होती। फिर 1 से 5 स्टार दें और झटपट टिप्पणियाँ चुनें: “ख़तरनाक ड्राइविंग”, “खिड़की से कचरा फेंकता है” या “विनम्र”।
>
> कोई अकाउंट नहीं, कोई ऐप डाउनलोड नहीं → <URL>
>
> 🚫📱 गाड़ी चलाते समय फ़ोन का इस्तेमाल न करें!

### Espagnol : X, LinkedIn, r/mexico / r/argentina / r/spain **seulement si les règles l'autorisent**

> 🚗⭐ He creado **Rate This Car**: haces una foto al coche de delante (¡como pasajero!), la matrícula se lee en tu propio móvil y calificas al conductor de 1 a 5 estrellas con comentarios rápidos: «conducción peligrosa», «tira basura por la ventanilla»… o «amable».
>
> Sin cuenta y sin descargar nada, funciona desde un enlace → <URL>
>
> La foto nunca sale de tu teléfono y las matrículas se guardan cifradas. ¿Me dais vuestra opinión? ¿Lee bien las matrículas de vuestro país?

### Vidéo courte (TikTok, Reels, Shorts) — script de 15 s

1. **0–2 s :** vue passager, la voiture devant jette une bouteille par la fenêtre.
   - Texte à l'écran : « Il a jeté ça par la fenêtre 😤 ».
   - **Mise en scène** avec une voiture d'un ami, ou plaque floutée.
2. **2–6 s :** le passager ouvre l'app, prend la photo, la plaque s'affiche instantanément.
   - Texte : « la plaque est lue sur le téléphone ».
3. **6–10 s :** 1 étoile, « Jette des déchets par la fenêtre », Publier.
4. **10–13 s :** la page de la plaque, avec sa moyenne et ses notes.
5. **13–15 s :** carton final.
   - « Rate This Car — sans appli, sans compte ».
   - Petit texte : « Filmé par un passager. 🚫📱 Jamais en conduisant. »

Variante « dev » : un écran partagé « code / téléphone » qui montre la plaque lue en 0,2 s.

---

## 6. Critiques à prévoir, et quoi répondre

| Critique | Réponse honnête |
|---|---|
| « C'est de la délation, du Black Mirror. » | On note un comportement, pas une personne : pas de nom, pas de recherche de propriétaire, pas de classement public. Les notes expirent et peuvent être signalées. Les retours positifs comptent autant que les négatifs. |
| « Rien n'empêche les faux avis ou la vengeance. » | Une note par appareil et par voiture et par jour, des limites par IP, le signalement qui masque, et la modération. Une note isolée ne pèse pas grand-chose. |
| « Et le RGPD ? » | Explique ce qui est stocké (et ce qui ne l'est pas), les durées et comment demander un retrait. Dis que tu as pris conseil **seulement si c'est vrai**. |
| « Les gens vont l'utiliser en conduisant. » | L'app le dit sur l'écran principal : passagers uniquement, ou une fois garé. |
| « Pourquoi pas une vraie app ? » | C'est une PWA : elle s'installe sur l'écran d'accueil depuis le navigateur. |

---

## 7. Et ensuite (idées selon les retours)

- **Mode « stats seulement »** : afficher la moyenne et les tags, sans les commentaires libres. Moins risqué juridiquement.
- **Cloudflare Turnstile** (anti-bot gratuit) si des scripts inondent l'API.
- **Traduction automatique** des commentaires libres. Les tags, eux, sont déjà traduits.
- **Si un jour tu veux les stores :** PWABuilder.com emballe la PWA pour le Play Store (25 $ une fois). Apple est plus strict : la règle 1.2 sur le contenu généré par les utilisateurs exige filtrage, signalement et blocage des abus. Depuis février 2026, Apple refuse aussi les apps de chat anonyme ou aléatoire. Ce n'est pas le cas ici, mais l'examen serait sévère.
