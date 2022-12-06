#define MAX_NUM_FILE_UPG 12
#define FW_UPG_BLK_LEN 128
#define DISK_SIZE 4096

extern unsigned char num_of_files;
extern bool upload_started;
extern unsigned char dns_socket, upgrade_socket;



struct pl_manifest {
	string dev_type;
	string hw_ver;
	string tmon_ver;
	string wifi_type;
	string wifi_hw_ver;
	string wifi_fw_ver;
	string wifi_mon_ver;
};

struct socket_assignment {
	unsigned char dns_socket;
	unsigned char upgrade_socket;
	unsigned char http_socket;
};

enum pl_fw_upg_state {
	PL_FW_UPG__INIT=0,
    PL_FW_READ_HEADER,
	PL_FW_UPG_READ_FW_TYPE,
	PL_FW_UPG_READ_LEN,
	PL_FW_UPG_READ_CHECKSUM,
	PL_FW_UPG_READ_FW,
	PL_FW_UPG_COMPLETE,
	PL_FW_UPG_FAIL,
	PL_FW_UPG_CANCEL
};


enum pl_upg_fw_type {
	TIOS_MON=0,
	COMPRESSED_TIOS,
	UNCOMPRESSED_TIOS,
	COMPRESSED_APP,
	UNCOMPRESSED_APP,
	COMPRESSED_TIOS_APP,
	UNCOMPRESSED_TIOS_APP,
	WA2000_MON,
	WA2000_APP,
	MANIFEST,
	WA3000_MON,
	WA3000_APP
};

enum pl_fw_upg_source {
	PL_FW_UPG_BLE=0,
	PL_FW_UPG_WEB,
	PL_FW_UPG_SOCK,
	PL_FW_UPG_SER,
	PL_FW_UPG_HTTP
};

enum pl_fw_upg_fail_reason {
	PL_FW_FAIL_NONE=0,
	PL_FW_FAIL_CANCEL,
	PL_FW_FAIL_NUMFILES,
	PL_FW_FAIL_INVALID_FW_TYPE,
	PL_FW_FAIL_INVALID_FW_LENGTH,
	PL_FW_FAIL_INVALID_FW_CHECKSUM,
	PL_FW_FAIL_SOURCE_UNKNOWN,
	PL_FW__FAIL_INVALID_HARDWARE
};

struct pl_upg_state_t {
     PL_FW_UPG_STATE state;
	 PL_FW_UPG_SOURCE source;
	 PL_FW_UPG_FAIL_REASON fw_fail_reason;
	 unsigned long fw_totalsize;
	 unsigned long fw_total_remaining;
	 unsigned char fw_numfiles;
	 unsigned char fw_types[[529 519 146 124]];
	 float fw_lengths[[529 519 146 124]];
	 unsigned long fw_checksums[[529 519 146 124]];

	 unsigned char fw_currentfile;
	 unsigned char fw_total_percent;
	 unsigned char fw_percent;
	 unsigned long fw_remaining;
	 unsigned int fw_sector;
	 unsigned int fw_page;
	 unsigned long fw_checksum;
	 unsigned char source_num;
	 unsigned char fw_receivedfiles;
};

enum baudrates {
	b1200,
	b2400,
	b4800,
	b9600,
	b19200,
	b38400,
	b56000,
	b57600,
	b115200,
	b128000,
	b153600,
	b230400,
	b256000,
	b460800,
	b921600
};

extern pl_upg_state_t current_fw_upg_state;

no_yes device_firmware_upload_async(PL_FW_UPG_SOURCE source, unsigned char number);
no_yes device_firmware_upload_update();

string hex_mac(string mac);

void set_baudrate(unsigned long baudrate);
void start_dns(string domainName);
void DHCP_DNS_init();


pl_upg_state_t get_fw_upg_state();

//Callback when the file type is read to let app know what will be updated.  
void on_firmware_update_start(pl_upg_state_t *current_fw_upg_state);

void on_firmware_update_data_received(pl_upg_state_t *current_fw_upg_state);

//Callback when data has been written to flash. 
void on_firmware_update_percent_change(pl_upg_state_t *current_fw_upg_state);

//Callback when all files have been downloaded. 
void on_firmware_update_file_complete(pl_upg_state_t *current_fw_upg_state);

//Callback when all files have been downloaded. 
void on_firmware_update_complete(pl_upg_state_t *current_fw_upg_state);

void init_serial(unsigned char port, unsigned long baud);
void init_receive_socket(string receive_interface);
void device_firmware_write_tios_app(string fw);
void device_firmware_write_wa2000_mon_app(string fw);
void device_firmware_read_manifest(string manifest);
void device_firmware_get_fw_block(pl_upg_state_t *dev_fw_upg_state);
unsigned long device_firmware_bytes_available();
unsigned long device_firmware_read_32_uint();
int get_firmware_index(PL_UPG_FW_TYPE fwtype);
void upgrade_WA2000_firmware(PL_UPG_FW_TYPE fw_type, unsigned char index);
