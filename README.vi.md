<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md"><b>Tiếng Việt</b></a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Một tấm gương chỉ đọc dành cho các plugin [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) mà bạn đã cài đặt: mỗi plugin **có thể làm gì**, chúng **xung đột** ở đâu và **điều gì đã thay đổi** kể từ lần quét gần nhất — kèm bằng chứng có thể kiểm tra cho từng khả năng được phát hiện.

Việc có cần dọn dẹp gì hay không là do bạn quyết định. harbor chỉ nêu sự thật; không phán xét, không kiểm soát việc cài đặt và không chặn bắt bất cứ thứ gì.

## harbor là gì — và không phải là gì

harbor chỉ làm một việc: duy trì một sổ theo dõi liên tục, có bằng chứng hỗ trợ về các plugin bạn đã cài đặt. Sổ này có ba phần — bản thân danh mục (mọi plugin bên thứ ba đã cài đặt, kèm vị trí mã nguồn khi bộ dò xác định được), sự đối chiếu giữa những gì từng plugin khai báo và những gì mã của nó thực sự làm, cùng dòng thời gian các thay đổi giữa các lần quét.

Những điều harbor chủ ý không làm cũng là một phần quan trọng trong thiết kế. harbor không thẩm định hay chặn plugin trước khi cài đặt — kiểm soát đầu vào thuộc về công cụ marketplace cho plugin. harbor không đi sâu vào việc giám sát các dependency upstream; kiểm tra upstream chỉ bao phủ phiên bản plugin và dừng ở đó. harbor không thực hiện kiểm toán mã nguồn nói chung, cũng không chặn bắt, ngăn chặn hay đưa hành vi plugin vào sandbox.

Điều cuối cùng không phải là quyết định về phạm vi mà là một thực tế của host. Runtime Cordis của DSH không có capability sandbox: plugin chạy trong Node realm chính của host, với chính các đặc quyền của host. harbor có thể làm cho các khả năng **hiển thị**, **phát hiện** chúng và **đối chiếu** chúng với khai báo — nhưng không thể tắt chúng. Việc giới hạn hành vi plugin cần được hỗ trợ ngay trong DSH loader, và quy trình khai báo bên dưới là cách xây dựng tiêu chuẩn đó bằng dữ liệu thay vì tranh luận một cách trừu tượng.

Cuối cùng, harbor báo cáo sự thật chứ không cho điểm. Đầu ra luôn là “đã phát hiện điều gì và bằng chứng ở đâu” — không bao giờ là mức độ rủi ro hay điểm chất lượng. Một phát hiện có ý nghĩa gì với bạn là phán đoán của bạn, không phải của harbor.

> **Trạng thái: `0.1.0-rc.1`, đang củng cố bản release candidate.** CLI, các route hub chỉ dành cho loopback, bảng cài đặt DSH, độ lệch giữa các profile và kiểm tra upstream tùy chọn đều đã khả dụng. Một host đang hoạt động cung cấp runtime tools, providers và routes; bên ngoài host như vậy, bằng chứng runtime hạ cấp rõ ràng thành `available: false`. Các detector vẫn mang tính heuristic và đang được hiệu chỉnh theo hệ sinh thái rộng hơn, vì vậy hãy xem xét bằng chứng thay vì coi việc không phát hiện là bằng chứng cho sự vắng mặt.

## Những gì được kiểm tra

```
~/.dsh/profiles/*                → các bundle bên thứ ba đã cài đặt (npm và link: như nhau)
  ├─ declared    package.json / cordis.patch.yml — plugin nói gì về chính nó
  ├─ runtime     tools / routes / providers thực sự được đăng ký trong host
  ├─ static      subprocess, egress, ghi config bên ngoài — kèm file:line
  ├─ versions    độ lệch (cục bộ, luôn kiểm tra) + upstream (qua mạng, tùy chọn)
  └─ snapshot    diff so với lần quét trước: phiên bản mới, khả năng mới
        └─ đối chiếu: dsh.capabilities đã khai báo so với những gì được phát hiện
```

Các khả năng là một tập cố định gồm mười ba mục — client injection, rủi ro realm, bản sao realm, global hooks, bộ điều hợp LLM, subprocesses, network egress, web routes, đăng ký tools, máy chủ MCP, ghi config bên ngoài, xử lý thông tin xác thực và đọc environment. Tập này được cố định để các báo cáo luôn có thể so sánh và tạo diff giữa các lần quét. Danh sách chính thức nằm trong [SPEC.md](./SPEC.md) §2; nguồn chân lý dành cho máy đọc là `src/scan/detectors.mjs`.

Cách diễn đạt được chủ ý giữ trung lập: **khả năng**, không phải rủi ro. Việc khởi chạy subprocesses chính là mục đích của một số plugin. Báo cáo trả lời “thứ này có thể làm gì” và để câu hỏi “nó có nên làm không” cho bạn.

## Phiên bản

harbor trả lời hai câu hỏi về phiên bản và giữ chúng tách biệt.

**Độ lệch giữa các profile** hoàn toàn mang tính cục bộ. Việc cùng một plugin có phiên bản khác nhau giữa các profile là một sự thật về máy này, nên được tính miễn phí trong mỗi lần quét. Bản cài đặt `link:` hoặc `file:` không được coi là mốc “mới nhất”: một working tree chạy trước phiên bản đã phát hành là chuyện bình thường, không phải độ lệch.

**Kiểm tra upstream** liên lạc ra ngoài máy, vì vậy không bao giờ là một phần của lần quét mặc định. CLI cần `harbor scan --check-updates`; bảng điều khiển yêu cầu bạn chủ động nhấn nút, và phần chữ cạnh nút nói rõ điều đó — đây là hành động duy nhất trên trang liên lạc ra ngoài máy của bạn. Mỗi kết quả thuộc một trong năm trạng thái:

- **behind** — registry có phiên bản mới hơn
- **current** — phiên bản đã cài đặt khớp với registry
- **ahead** — phiên bản đã cài đặt mới hơn registry (một trạng thái thực tế trên máy của người bảo trì)
- **local** — bản cài đặt `link:` / `file:` không có upstream để so sánh và không bao giờ được hiển thị là “đã cập nhật”
- **unknown** — truy vấn thất bại

registry được đọc từ `.npmrc` của chính bạn (bao gồm các ghi đè `@scope:registry`), không bao giờ bị hardcode thành npmjs. Kết quả được cache trên đĩa trong sáu giờ.

## Cài đặt

Để phát triển cục bộ, hãy cài đặt từ một checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` chuyển tiếp các đối số còn lại cho pnpm bên trong thư mục profile, còn `link:` tạo symlink từ dependency của profile đến checkout này, nên kết quả build lại xuất hiện trực tiếp. Khi cài đặt từ registry, hãy dùng tag ứng viên `next`:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Sau đó hãy khởi động lại DSH để lớp profile mới được tải.

Bảng điều khiển xuất hiện trong Web UI của DSH dưới **Settings** với tên **DSH Harbor** — cùng một tấm gương như CLI: danh mục kèm bằng chứng, xung đột, phiên bản và diff kể từ lần quét gần nhất. Nút **Check for updates** là hành động duy nhất trên trang liên lạc ra ngoài máy của bạn. Bảng điều khiển là phần hub của plugin và chỉ được mount trong các profile có web server.

Tệp thực thi của plugin được cài đặt bên trong profile đã chọn; thêm plugin vào `web` không đưa `harbor` vào `PATH` toàn cục của shell. Hãy chạy nó thông qua profile đó:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Để chạy từ checkout hoặc chạy một lần qua registry, hãy dùng một trong các lệnh sau:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Cách sử dụng

Các ví dụ bên dưới dùng `harbor` làm cách viết tắt cho một trong các hình thức gọi lệnh ở trên.

```bash
harbor scan                 # danh mục, xung đột và các thay đổi kể từ lần quét gần nhất
harbor scan --check-updates # + kiểm tra upstream tùy chọn với registry (qua mạng)
harbor manifest ./my-plugin # phác thảo khối dsh.capabilities cho plugin của bạn
```

Thêm `--evidence` để in bằng chứng nguồn `file:line` hiện có, `--json` để xuất báo cáo đầy đủ dành cho máy đọc và `--no-snapshot` để bỏ qua việc ghi mốc cơ sở cho diff. Các dữ kiện lấy từ manifest, filesystem hoặc runtime có thể không có dòng mã nguồn và sẽ được gắn nhãn tương ứng.

Bộ quét không có dependency và không cần cài đặt DSH, vì vậy cũng chạy được trong CI.

## Dành cho tác giả plugin

`harbor manifest` đọc plugin của bạn theo cùng cách nó đọc tất cả plugin khác và phác thảo thành phần `capabilities` để merge vào object `dsh` hiện có trong `package.json`; nó không bao giờ yêu cầu bạn thay thế object đó rồi làm mất cấu hình `bundle` hoặc `client`. Sau khi khai báo, phép kiểm tra của harbor trở thành **đã khai báo so với đã phát hiện**: những khả năng bạn khai báo nhưng không bao giờ dùng là phần nhiễu có thể loại bỏ, còn các khả năng được phát hiện nhưng chưa khai báo là những điều đáng giải thích. harbor cũng khai báo `dsh.capabilities` của chính mình, vì vậy có thể tái hiện quy trình này trên chính công cụ: chạy `harbor manifest .` trong repository này.

Quy ước này được viết trong [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). Tóm lại trong một câu: `dsh.capabilities` là một danh sách thuần trong `package.json` nêu rõ mã của plugin thực sự làm gì. Việc khai báo rất đơn giản và mang lại hai lợi ích — công cụ kiểm toán như harbor có thể đối chiếu lời bạn với mã nguồn, còn người chạy plugin có thể thấy bạn không che giấu điều gì. Tự kiểm tra khai báo của bạn bất cứ lúc nào bằng `harbor manifest <dir>`.

## Các giới hạn, nói thẳng

harbor đọc mã nguồn của mọi plugin, khiến nó trở thành thành phần có đặc quyền cao nhất trong môi trường. Nó cũng xuất hiện trong chính báo cáo của mình.

Khi kiểm tra upstream được bật, bản thân harbor có khả năng network-egress, và khai báo `dsh.capabilities` của nó đã liệt kê khả năng này.

## Giấy phép

MIT
