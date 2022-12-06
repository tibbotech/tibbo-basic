//***********************************************************************************************************
//			FILE NUMBER ALLOCATION LIBRARY
//***********************************************************************************************************

#ifndef FILENUM_DEBUG_PRINT
	#define FILENUM_DEBUG_PRINT 0
#endif

//Maximum length of the file number user's signature string
#ifndef FILENUM_MAX_SIGNATURE_LEN
	#define FILENUM_MAX_SIGNATURE_LEN 0
#endif

#ifndef FILENUM_MAX_FILENAME_LEN
	#define FILENUM_MAX_FILENAME_LEN 0
#endif

//------------------------------------------------------------------------------
unsigned char filenum_open(string *signature, string *filename, pl_fd_status_codes *status);
unsigned char filenum_get(string *signature);
string filenum_who_uses(unsigned char file_num);
void filenum_release(unsigned char file_num);