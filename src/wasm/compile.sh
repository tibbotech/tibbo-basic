echo "Compiling..."

docker run --rm -v $(pwd):/src -u $(id -u):$(id -g) \
  emscripten/emsdk emcc -I/src tios.cpp Sys/ntios_sys.cpp -o tios.js -sMODULARIZE -sEXPORTED_RUNTIME_METHODS=ccall



#emcc tios.cpp -o tios.js -sMODULARIZE -sEXPORTED_RUNTIME_METHODS=ccall

