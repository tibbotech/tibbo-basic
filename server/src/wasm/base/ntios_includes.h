/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef THREADS_NTIOS_INCLUDES_H_
#define THREADS_NTIOS_INCLUDES_H_

/* INCLUDES */
// #include "base/ntios_base.h"
// #include "beep/ntios_beep.h"
// #include "button/ntios_button.h"
// #include "io/ntios_io.h"
// #include "pat/ntios_pat.h"
// #include "pmux/ntios_pmux.h"
// #include "ser/ntios_ser.h"
// #include "ssi/ntios_ssi.h"
#include "sys/ntios_sys.h"
#include "syscalls/ntios_aes.h"
#include "syscalls/ntios_conv.h"
#include "syscalls/ntios_datetime.h"
#include "syscalls/ntios_math.h"
#include "syscalls/ntios_md5.h"
#include "syscalls/ntios_rc4.h"
#include "syscalls/ntios_sha1.h"
#include "syscalls/ntios_strman.h"
// #include "fd/ntios_fd.h"
// #include "romfile/ntios_romfile.h"
// #include "stor/ntios_stor.h"


// /* GLOBAL INSTANCES */
// /*
// * REMARK:
// *   Parameters which are defined with the leading 'extern', should be also defined in:
// *   1. their corresponding xxx.cpp file (e.g. pat.cpp, ssi.cpp, etc.)
// *   2. threads/ntios_objects.cpp (for some cases).
// */
// extern ntios::base::P1 ntios_p1;
// extern ntios::base::P2 ntios_p2;
// extern ntios::base::Periodic ntios_per;

// extern ntios::IO io;
// extern ntios::flashdisk::FD fd;
// extern ntios::beeppattern::BEEP beep;
// extern ntios::pattern::PAT pat;
// extern ntios::pmux Pmux;
// extern ntios::romFile::ROMFILE romfile;
// extern ntios::serial::ser ser;
// extern ntios::ssintf::SSI ssi;
// extern ntios::storage::STOR stor;
// extern ntios::syst::SYS sys;

// /* POINTERS */
// extern ntios::base::ev2_fifo_message_t *p2_ev2_last_msg;



// /* NAMESPACES */
// using ntios::conv::asc;
// using ntios::conv::strsum;
// using ntios::conv::bin;
// using ntios::conv::lbin;
// using ntios::conv::chr;
// using ntios::conv::hex;
// using ntios::conv::lhex;
// using ntios::conv::hex2asc;
// using ntios::conv::hex2chr;
// using ntios::conv::chr2hex;
// using ntios::conv::str2hex;
// using ntios::conv::cchar2str;
// using ntios::conv::ddstr;
// using ntios::conv::ddval;
// using ntios::conv::ftostr;
// using ntios::conv::strtof;
// using ntios::conv::str;
// using ntios::conv::stri;
// using ntios::conv::lstr;
// using ntios::conv::lstri;
// using ntios::conv::val;
// using ntios::conv::lval;

// using ntios::datetime::date;
// using ntios::datetime::weekday;
// using ntios::datetime::month;
// using ntios::datetime::year;
// using ntios::datetime::daycount;
// using ntios::datetime::hours;
// using ntios::datetime::minutes;
// using ntios::datetime::mincount;
// using ntios::datetime::datetime_local_current;
// using ntios::datetime::timestamp_local_current_milliseconds;

// using ntios::strman::insert;
// using ntios::strman::isNumeric;
// using ntios::strman::len;
// using ntios::strman::left;
// using ntios::strman::mid;
// using ntios::strman::right;
// using ntios::strman::instr;
// using ntios::strman::random;
// using ntios::strman::strgen;
// using ntios::strman::strand;
// using ntios::strman::stror;
// using ntios::strman::strxor;

using namespace std;
using namespace ntios::conv;
ntios::syst::SYS sys;


#endif  // THREADS_NTIOS_INCLUDES_H_
