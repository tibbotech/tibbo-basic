//***********************************************************************************************************
//			WI-FI LIBRARY
//			(Works with GA1000)
//***********************************************************************************************************

//##################################################

//1- debug output enabled, destination depends on WLN_DEBUG_REDIR
//0- no debug output.
#ifndef WLN_DEBUG_PRINT
	#define WLN_DEBUG_PRINT 0
#endif

//Only relevant when WLN_DEBUG_PRINT is 1
//1- will invoke callback_wln_debuginfo() to output debug printing
//0- will use sys.debugprint to output to console
#ifndef WLN_DEBUG_REDIR
	#define WLN_DEBUG_REDIR 0
#endif

//0- dedicated RST line. Remember to define this line's mapping with WLN_RST.
//1- CS and CLK lines are to generate reset (special hardware circuit required).
#ifndef WLN_RESET_MODE
	#define WLN_RESET_MODE 0
#endif

//RST line mapping.
//Only relevant when WLN_RESET_MODE=0.
#ifndef WLN_RST
	#define WLN_RST PL_IO_NULL
#endif

//CS line mapping.
#ifndef WLN_CS
	#define WLN_CS PL_IO_NULL
#endif

//DI line mapping.
#ifndef WLN_DI
	#define WLN_DI PL_IO_NULL
#endif

//DO line mapping.
#ifndef WLN_DO
	#define WLN_DO PL_IO_NULL
#endif

//CLK line mapping.
#ifndef WLN_CLK
	#define WLN_CLK PL_IO_NULL
#endif

//0- do not send keepalive UDP datagrams (saves code and memory space).
//1- send keepalive UDP datagrams to prevent disassociation from the access point.
#ifndef WLN_KEEP_ALIVE
	#define WLN_KEEP_ALIVE 0
#endif

//Time interval, in 1/2 second increments, between keepalive UDP datagrams.
//Only relevant when WLN_KEEP_ALIVE=1.
#ifndef WLN_KEEP_ALIVE_TOUT
	#define WLN_KEEP_ALIVE_TOUT 120
#endif

//0- disable WPA1/WPA2 support (saves code and memory space).
//1- enable WPA1/WPA2 support.
#ifndef WLN_WPA
	#define WLN_WPA 0
#endif

#ifndef WLN_RESCAN_TMR_CTR_CONNECT
	#define WLN_RESCAN_TMR_CTR_CONNECT 120
#endif

#ifndef WLN_RESCAN_TMR_CTR_NO_CONNECT
	#define WLN_RESCAN_TMR_CTR_NO_CONNECT 140
#endif
//------------------------------------------------------------------------------
enum pl_wln_check_association_retval {
	WLN_ASSOCIATION_RETVAL_NO,
	WLN_ASSOCIATION_RETVAL_YES,
	WLN_ASSOCIATION_RETVAL_INPROG
};

#if WLN_WPA
	enum pl_wln_security_modes {
		WLN_SECURITY_MODE_DISABLED,
		WLN_SECURITY_MODE_WEP64,
		WLN_SECURITY_MODE_WEP128,
		WLN_SECURITY_MODE_WPA1,
		WLN_SECURITY_MODE_WPA2
	};
#else
	enum pl_wln_security_modes {
		WLN_SECURITY_MODE_DISABLED,
		WLN_SECURITY_MODE_WEP64,
		WLN_SECURITY_MODE_WEP128
	};
#endif

enum en_wln_status_codes {
	WLN_STATUS_OK,//Success.
	WLN_STATUS_OUT_OF_SOCKETS,//No free sockets available for the library to operate.
	WLN_STATUS_INSUFFICIENT_BUFFER_SPACE,//Insufficient number of buffer pages available and the call to callback_wln_pre_buffrq() failed to cure the problem.
	WLN_STATUS_MISSING_FIRMWARE_FILE,//You forgot to add "ga1000fw.bin" file to your project.
	WLN_STATUS_BOOT_FAILURE,//Wi-Fi hardware could not be booted (improperly connected? turned off? ...).
	WLN_STATUS_INVALID_SECURITY_MODE,//Incorrect security mode specified in the security_mode argument of the wln_start() function.
	WLN_STATUS_INVALID_WEP_KEY,//WEP64 or WEP128 was specified when calling to wln_start(), and the length of the key argument is incorrect. The length must be 10 hex characters for WEP64 and 26 hex characters for WEP128.
	WLN_STATUS_SCANNING_FAILURE,//Failed to discover the target wireless network.
	WLN_STATUS_ASSOCIATION_FAILURE,//Failed to associate with the target wireless network.
	WLN_STATUS_DISASSOCIATION,//Wi-Fi interface got disassociated from the target wireless network.
	WLN_STATUS_UNEXPECTED_ERROR,//Well, this is something... unexpected :).
	WLN_STATUS_NOT_STARTED,//The procedure couldn't be executed because the library hasn't been started (call wln_start() first).
	WLN_STATUS_BUSY//The procedure couldn't be executed because the library is busy. Try again after a short delay.
	WLN_STATUS_AUTOCONNECT//The wln module is in autoconnect mode and is handling all wireless functionality.  
};

enum wln_info_elements {
	WLN_INFO_ELEMENT_REQUIRED_BUFFERS
};

//------------------------------------------------------------------------------
string wln_get_info(wln_info_elements info_element, string *extra_data);
en_wln_status_codes wln_start(string *ap_name, pl_wln_security_modes security_mode, string *key, pl_wln_domains domain, no_yes active_scan, pl_wln_scan_filter scanfilter);
en_wln_status_codes wln_change(string *ap_name, pl_wln_security_modes security_mode, string *key);
void wln_stop();
pl_wln_check_association_retval wln_check_association();
void wln_proc_timer();

void wln_proc_event(pl_wln_events wln_event);
void wln_proc_task_complete(pl_wln_tasks completed_task);

extern pl_wln_module_types wln_module_type;
void wln_proc_data();

#if WLN_WPA
string wln_wpa_mkey_get(string *password, string *ssid);
#endif

void wln_update_rssi();
void wln_start_rescan();
void wln_check_for_better_ap(unsigned char rssi_lvl);

void callback_wln_failure(en_wln_status_codes wln_state);
void callback_wln_ok();
void callback_wln_starting_association();
void callback_wln_pre_buffrq(unsigned char required_buff_pages);
void callback_wln_mkey_progress_update(unsigned char progress);
void callback_wln_rescan_result(unsigned char current_rssi, unsigned char scan_rssi, no_yes different_ap);
void callback_wln_debugprint(string print_data);
void callback_wln_rescan_for_better_ap();
void wln_delay_ms(unsigned long ms);
void wln_init();
void wln_init_gpio();
void wln_reset();
void wln_autoconnect(bool enable);
//#############################################################