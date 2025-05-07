echo "Compiling..."

docker run --rm -v $(pwd):/src -u $(id -u):$(id -g) \
  emscripten/emsdk emcc -I/src \
  main.cpp \
  Sys/ntios_sys.cpp \
  syscalls/ntios_aes.cpp \
  syscalls/ntios_conv.cpp \
  syscalls/ntios_datetime.cpp \
  syscalls/ntios_math.cpp \
  syscalls/ntios_md5.cpp \
  syscalls/ntios_rc4.cpp \
  syscalls/ntios_sha1.cpp \
  syscalls/ntios_strman.cpp \
  -o main.js -sMODULARIZE -sEXPORTED_RUNTIME_METHODS=ccall



#emcc tios.cpp -o tios.js -sMODULARIZE -sEXPORTED_RUNTIME_METHODS=ccall

