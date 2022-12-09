//***********************************************************************************************************
//			SOCKET ALLOCATION LIBRARY
//***********************************************************************************************************

//1- debug output in console.
//0- no debug output.
#ifndef SOCK_DEBUG_PRINT
	#define SOCK_DEBUG_PRINT 0
#endif

#if SYS_VER == 2000 || SYS_VER == 3000

#define SOCK_MAX_SOCKETS_PLATFORM 32

#else
	#define SOCK_MAX_SOCKETS_PLATFORM 16
#endif
//Maximum length of the socket user's signature string
#ifndef SOCK_MAX_SIGNATURE_LEN
	#define SOCK_MAX_SIGNATURE_LEN 3
#endif

//------------------------------------------------------------------------------
unsigned char sock_get(string *signature);
string sock_who_uses(unsigned char sock_num);
void sock_release(unsigned char sock_num);