//DEFINES-------------------------------------------------------------
#define DHCP_DEBUG_PRINT 1
#define DHCP_POST_FAIL_DELAY 30
#define DHCP_WAIT_TIME 8
#define SOCK_MAX_SIGNATURE_LEN 32
#define SSI_MAX_SIGNATURE_LEN 32
#define SI2C_MAX_SIGNATURE_LEN 32
#define SSPI_MAX_SIGNATURE_LEN 32
#define CTS_MAP 0
#define RTS_MAP 0




#define FIRMWARE_VERSION "{MyDevice 1.0.0}"

#define MAX_NUM_INTERFACES 4



//INCLUDES------------------------------------------------------------




#include "libraries/sock/sock.th"
#include "libraries/time/time.th"
#include "libraries/wln/wln.th"
#include "libraries/dhcp/dhcp.th"
#include "libraries/time/datetime.th"
#include "libraries/utils/utils.th"
#include "libraries/upgrade/upgrade.th"
#include "libraries/filenum/filenum.th"
#include "libraries/tables/tables.th"
#include "libraries/tables/tables_web.th"


//DECLARATIONS--------------------------------------------------------

unsigned long datetime_timestamp_mins(unsigned long timestamp);
unsigned long datetime_mins_to_timestamp(unsigned int mins);


extern string<16> device_net_ip;
extern string<16> device_net_mask;
extern string<16> device_net_gateway;

void interface_set(pl_sock_interfaces interface, no_yes state);

extern no_yes interface_ready[MAX_NUM_INTERFACES];
extern en_td_timezones APP_TIMEZONE;

extern pl_sock_interfaces current_interface;

void change_current_interface(pl_sock_interfaces new_interface);
void close_interface_sockets(pl_sock_interfaces interface);
extern unsigned char upgrade_socket_http;
string web_get_url_params(string *http_req_string, string *argument);
en_tbl_status_codes tbl_record_find_sorted(en_tbl_record_states record_type, string *search_data, string *field_name, unsigned int *rec_num, bool wraparound, pl_fd_find_modes find_method);


void boot();
