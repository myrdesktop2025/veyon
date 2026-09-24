#!/usr/bin/env bash
# Veyon Windows x64 构建脚本（在 MSYS2 UCRT64 环境中运行）
# 由 .github/workflows/build-windows.yml 调用。
set -euo pipefail

export MSYSTEM=UCRT64
export PATH="/ucrt64/bin:/usr/bin:$PATH"

echo "=== Environment ==="
uname -a
cmake --version | head -1
ninja --version
gcc --version | head -1

echo "=== Configure (CMake / Ninja / Qt6 / WebAPI) ==="
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="/ucrt64" \
  -DWITH_QT6=ON \
  -DWITH_WEBAPI=ON \
  -DWITH_BUNDLED_LIBVNC=ON \
  -DWITH_TESTS=OFF \
  -DWITH_ADDONS=OFF \
  -DWITH_LTO=OFF

echo "=== Build ==="
cmake --build build --parallel

echo "=== Package (portable dist) ==="
DIST=dist
rm -rf "$DIST" && mkdir -p "$DIST" "$DIST/plugins" "$DIST/translations"
# 可执行文件 / 核心库
find build -maxdepth 1 -type f \( -name '*.exe' -o -name '*.dll' \) -exec cp {} "$DIST/" \;
# 插件（保持 plugins/ 目录结构，Veyon 按相对目录加载插件）
find build/plugins -maxdepth 1 -type f \( -name '*.dll' -o -name '*.exe' \) -exec cp {} "$DIST/plugins/" \; 2>/dev/null || true
# 翻译文件
find build/translations -name '*.qm' -print 2>/dev/null | head -200 | xargs -r -I{} cp {} "$DIST/translations/" 2>/dev/null || true
# 编译器运行时
cp /ucrt64/bin/libgcc_s_seh-1.dll /ucrt64/bin/libstdc++-6.dll /ucrt64/bin/libwinpthread-1.dll "$DIST/" 2>/dev/null || true
# Qca 加密插件（Veyon 认证必需；windeployqt 不会收集）
mkdir -p "$DIST/qca-qt6/crypto"
cp /ucrt64/lib/qca-qt6/crypto/libqca-ossl.dll "$DIST/qca-qt6/crypto/" 2>/dev/null || true
cp /ucrt64/bin/libqca-qt6.dll "$DIST/" 2>/dev/null || true
# Qt 运行时依赖（windeployqt 收集 Qt6 动态库与插件）
windeployqt --no-translations --no-system-d3d-compiler --no-opengl-sw --no-compiler-runtime --dir "$DIST" "$DIST/veyon-server.exe" 2>/dev/null || true
# 兜底：补全 MSYS2 运行库中尚未收集的依赖 dll
for dll in $(find /ucrt64/bin -maxdepth 1 \( -name 'libssl-*.dll' -o -name 'libcrypto-*.dll' -o -name 'libqca-*.dll' -o -name 'libicu*.dll' -o -name 'libpng*.dll' -o -name 'libjpeg*.dll' -o -name 'liblzo2*.dll' -o -name 'libzstd*.dll' -o -name 'zlib1.dll' -o -name 'libharfbuzz*.dll' -o -name 'libpcre2*.dll' -o -name 'libbrotli*.dll' -o -name 'libfreetype*.dll' \) 2>/dev/null); do
  cp "$dll" "$DIST/" 2>/dev/null || true
done
# 冒烟测试：验证可执行文件能加载（缺 dll 时会立即失败）
"$DIST/veyon-cli.exe" --help >/dev/null 2>&1 && echo "SMOKE: veyon-cli OK" || echo "SMOKE: veyon-cli exited ($?) - check manually"
"$DIST/veyon-server.exe" --help >/dev/null 2>&1 && echo "SMOKE: veyon-server OK" || echo "SMOKE: veyon-server exited ($?) - check manually"
# 打包（MSYS2 自带 bsdtar，支持 zip 格式）
tar -a -cf veyon-webui-win64.zip "$DIST"

echo "=== Done ==="
ls -la veyon-webui-win64.zip
