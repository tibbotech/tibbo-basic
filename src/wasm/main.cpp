#include <iostream>
#include <sstream>
#include <stdio.h>
#include <emscripten.h>
#include "Sys/ntios_sys.h"

using namespace std;

int counter = 0;

ntios::syst::SYS sys;

void on_sys_timer()
{
    counter++;
    sys.debugprint("on_sys_timer: " + to_string(counter));
    if (counter == 10) {
        sys.onsystimerperiod = 100;
    }
}

void on_sys_init()
{
    sys.debugprint("init");
}

void timer(void *)
{
    emscripten_async_call(timer, nullptr, sys.onsystimerperiod * 10);
    on_sys_timer();
}

int main()
{
    on_sys_init();
    timer(nullptr);
}
