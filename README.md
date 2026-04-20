Install Global (opsional)
bash
npm run install-global
# atau
npm install -g .
🚀 Cara Penggunaan
Menjalankan
bash
npm start
# atau jika sudah diinstall global
megaverse
# atau
ai-cli
Perintah dalam Aplikasi
Perintah	Fungsi
exit	Keluar dari aplikasi
model	Ganti model AI
mode	Ganti mode AI
cdn	Upload file ke CDN
memory	Lihat ringkasan memory
clear	Hapus memory percakapan
stats	Lihat statistik memory
sandbox	Lihat status sandbox
🎮 Mode AI
Mode	Kegunaan
Normal	Asisten umum, ramah, profesional
Technical	Fokus programming, coding, teknologi
Creative	Menulis, seni, ide kreatif
Educational	Mengajar, menjelaskan konsep
Business	Analisis pasar, strategi bisnis
🤖 Model AI
Model	Deskripsi
Gemini	Model Google, cepat dan akurat
Copilot	Model Microsoft, integrasi dengan search
Z.ai	Model GLM-4.6 dari Z.ai
Random	Pilih model acak (tetap dalam 1 sesi)
🏖️ Sandbox
Sandbox adalah lingkungan aman untuk menjalankan kode.

Cara Menggunakan Sandbox
Minta AI untuk menjalankan kode

AI akan meminta izin dengan format: "Saya perlu menjalankan kode di sandbox untuk: [alasan]. Apakah boleh?"

Ketik setuju atau gas

AI akan mengeksekusi kode dan menampilkan hasil

Yang Bisa Dilakukan di Sandbox
Menulis dan menjalankan kode JavaScript (Node.js)

Menulis dan menjalankan kode Python

Menjalankan perintah bash (ls, cat, echo, mkdir, dll)

Menginstall package npm atau pip

Melakukan request HTTP (curl/axios)

Membaca dan menulis file

📤 CDN Upload
Media dalam respons AI akan otomatis diupload ke CDN.

Manual Upload
Ketik cdn lalu masukkan path file.

Endpoint CDN
text
POST https://api.kabox.my.id/api/upload
Header: x-expire: 1d
Body: file=@gambar.jpg
📊 Struktur Proyek
text
ai-cli/
├── index.js                 # Entry point
├── package.json             # Dependencies
├── README.md                # Dokumentasi
└── src/
    ├── cli/
    │   └── CLIMain.js       # UI utama
    ├── core/
    │   ├── SandboxManager.js # Manajemen sandbox
    │   ├── CDNManager.js     # Upload CDN
    │   └── MemoryManager.js  # Memory dengan ringkasan AI
    ├── models/
    │   └── AIModels.js       # Gemini, Copilot, Z.ai, Random
    └── prompts/
        └── SystemPrompt.js   # System prompts untuk semua mode
🔧 Alur Kerja
text
User Input
    ↓
Memory Manager (simpan & ringkas)
    ↓
Pilih Model & Mode
    ↓
System Prompt + Context
    ↓
AI Model (Gemini/Copilot/Z.ai)
    ↓
Deteksi Media → CDN Upload
    ↓
Deteksi Sandbox Request → Minta Izin
    ↓
Typing Animation → Tampilkan Output
    ↓
Simpan ke Memory → Selesai
📝 Contoh Penggunaan
1. Chat Normal
text
💬 Anda: Jelaskan apa itu REST API

🤖 Megaverse:
REST API (Representational State Transfer Application Programming Interface) adalah...

[penjelasan detail]
2. Menjalankan Kode
text
💬 Anda: Jalankan kode Python: print(2 + 3)

🤖 Megaverse:
Saya perlu menjalankan kode Python di sandbox untuk: mengeksekusi perintah print. Apakah boleh?

💬 Anda: setuju

✅ Izin sandbox diberikan!
🏖️ Sandbox ID: a1b2c3d4...
Menjalankan task otomatis di sandbox...

Hasil: 5
3. Upload CDN Otomatis
text
💬 Anda: Buatkan gambar pemandangan

🤖 Megaverse:
Saya akan generate gambar pemandangan...

📸 Mendeteksi media dalam response...
✅ CDN Upload berhasil!
   📁 image: https://api.kabox.my.id/file/xyz123.jpg
⚙️ Konfigurasi
Edit src/prompts/SystemPrompt.js untuk mengubah system prompt.

🐛 Troubleshooting
Masalah	Solusi
Module not found	Jalankan npm install
Sandbox error	Pastikan Node.js/Python terinstall
CDN upload gagal	Cek koneksi internet
Model error	Ganti model dengan perintah model
📜 Lisensi
MIT License - Bebas digunakan dan dimodifikasi.

🙏 Credits
Dibuat oleh Megaverse untuk kebutuhan chat AI yang powerful dan fleksibel.

Made with ❤️ by Megaverse
