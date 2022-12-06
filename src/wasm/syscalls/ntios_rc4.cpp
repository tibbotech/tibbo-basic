/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <string>
#include <iostream>

#include "base/ntios_types.h"
#include "syscalls/ntios_conv.h"
#include "syscalls/ntios_strman.h"
#include "syscalls/ntios_rc4.h"



/* NAME SPACE */
namespace ntios {
namespace rc4 {
    /* CONSTANTS */
    const U16 TB_STRLEN_LIMIT65K = 65535;
    const char *const TB_EMPTYSTRING = "";



    /***********/
    /* PRIVATE */
    /***********/
    /*
    * PRE-DEFINED FUNCTIONS
    */
    static U8 *string_to_u8ptr(const std::string & str);
    static std::string u8ptr_to_string(U8 *u8_ptr, size_t datalen);
    static void sbox_swap(U8 *s, U32 a, U32 b);
    static size_t hstrlen(U8 * input_ptr);
    static void rc4_calc(const U8 *keyptr, U32 key_len, \
                            const U8 *dataptr, U32 data_len, \
                                U8 *cypherptr, \
                                    U32 skip);



    /* FUNCTIONS */
    static U8 *string_to_u8ptr(const std::string & str) {
        /* Convert from 'string' to 'const char pointer' */
        const char *str_ptr = str.c_str();

        /* Convert from 'char pointer' to 'unsighed char pointer' */
        char *str_arr = const_cast <char*>(str_ptr);

        /* Output */
        return reinterpret_cast <U8*>(str_arr);
    }

    static std::string u8ptr_to_string(U8 *u8_ptr, size_t datalen) {
        /* Define variables */
        U32 i;
        U8 asc_item;
        std::string ret, str_item;

        /* Cycle through each 8-bit character of u8_ptr */
        for (i = 0; i < datalen; i++) {
            asc_item = u8_ptr[i];
            str_item = ntios::conv::chr(asc_item);

            ret = ret + str_item;
        }

        /* Output */
        return ret;
    }

    static void sbox_swap(U8 *s, U32 a, U32 b) {
        /* Define variables */
        U8 s_bck;

        /* SWAP */
        /* s[a] becomes s[b] */
        s_bck = s[a]; /* backup s[a] */
        s[a] = s[b]; /* s[a] becomes s[b] */
        s[b] = s_bck;   /* s[b] becomes s[a] */
    }

    static size_t hstrlen(U8 *input_ptr) {
        /* Define variables */
        size_t len = 0U;

        /* Get Length of U8 Pointer */
        while (*(input_ptr++)) {
            ++len;
        }

        /* Output */
        return len;
    }

    static void rc4_calc(const U8 *keyptr, U32 key_len, \
                            const U8 *dataptr, U32 data_len, \
                                U8 *cypherptr, \
                                    U32 skip) {
        /*
        * Method:
        *   Encrypts/decrypts the data stream according to the RC4 (Symmetric) Encryption Algorithm.
        * Input:
        *   data: data to be Encrypted / Decrypted.
        *   data_len: data-length
        *   keyptr: encryption key
        *   key_len: key-length
        *   cypherptr: Encrypted / Decrypted data (OUTPUT)
        *   skip: the number of "skip" iterations. These are additional iterations
        *           added past the standard "key scheduling algorithm". Set this 
        *           argument to 0 to obtain standard encryption results compatible 
        *           with other systems.
        * Output:
        *   cypherptr: Encrypted / Decrypted data.
        */

        /* Define variables */
        U32 i, j, n;
        U8 swap;
        U8 sbox[256];

        /* 1. Initalization */
        for (i = 0; i < 256; i++) {
            sbox[i] = i;
        }

        /* 2. KSA: Generate State Array */
        j = 0;
        for (i = 0; i < 256; i++) {
            j = (j + sbox[i] + keyptr[i % key_len]) % 256;  /* update index j */

            /* Swap sbox[i] and sbox[j]*/
            swap = sbox[i];
            sbox[i] = sbox[j];
            sbox[j] = swap;
        }

        /* 3. Skip the 'start' of the stream (if skip != 0) */
        /*
        * Note:
        *   Set 'skip = 0' to obtain the 'STANDARD' encryption result.
        */
        i = 0;
        j = 0;
        for (n = 0; n < skip; n++) {
            /* Note: mod 256 = % 256 = & 0xff */
            i = (i + 1);  /* update index i */
            j = (j + sbox[i]) % 256;    /* update index j */

            /* Swap sbox[i] and sbox[j]*/
            swap = sbox[i];
            sbox[i] = sbox[j];
            sbox[j] = swap;
        }

        /* 4. Apply RC4 to data */
        for (n = 0; n < data_len; n++) {
            /* Note: mod 256 = % 256 = & 0xff */
            i = (i + 1);  /* update index i */
            j = (j + sbox[i]) % 256;    /* update index j */

            /* Swap sbox[i] and sbox[j]*/
            swap = sbox[i];
            sbox[i] = sbox[j];
            sbox[j] = swap;

            /* XOR */
            if (dataptr && cypherptr) {
                cypherptr[n] = sbox[(U8)(sbox[i]+sbox[j])]^dataptr[n];
            }
        }
    }



    /**********/
    /* PUBLIC */
    /**********/
    std::string rc4(const std::string &key, \
                        size_t skip, \
                            const std::string &data) {
        /*
        * Method:
        *   Encrypts/decrypts the data stream according to the RC4 (Symmetric) Encryption Algorithm.
        * Input:
        *   key: encryption key.
        *       Maximum String-length is 65535. If the length is exceeded, 
        *       the function will return an Empty String. 
        *   skip: the specified number of bytes to be skipped at the start of the stream.
        *       Set value to 0 to obtain standard encryption result which is compatible with other systems.
        *   data: data to Encrypt / Decrypt.
        *       Maximum String-length is 65535. If the length is exceeded, 
        *       the function will return an Empty String.
        * Output:
        *   Encrypted / Decrypted data.
        */
        /* Define variables */
        U8 *key_ptr, *data_ptr;
        U32 key_len, data_len;
        std::string ret;

        /* Get lengths */
        key_len = key.length();
        data_len = data.length();

        /* 
        * Check if string-length of 'key' exceeds the maximum allowed number of characters (65535)
        */
        if (key_len > TB_STRLEN_LIMIT65K) {
            return TB_EMPTYSTRING;
        }

        /* 
        * Check if string-length of 'data' exceeds the maximum allowed number of characters (65535)
        */
        if (data_len > TB_STRLEN_LIMIT65K) {
            return TB_EMPTYSTRING;
        }

        /*
        * When reading string 'input', for each character,
        *   convert from 'const char*' to 'U8'.
        */
        key_ptr = string_to_u8ptr(key);
        data_ptr = string_to_u8ptr(data);

        /* Define output pointer */
        U8 *cypher_ptr = new uint8_t[data_len];

        /* Calculate RC4 */
        rc4_calc(key_ptr, key_len, data_ptr, data_len, cypher_ptr, skip);

        /* Convert output from 'U8 poU32er' to 'string' */
        ret = u8ptr_to_string(cypher_ptr, data_len);

        /* RESET
        * Standard cleanup for data allocated on the heap
        */
        delete[] cypher_ptr;

        /* Output */
        return ret;
    }

}  // namespace rc4
}  // namespace ntios
