/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <string>
#include <iostream>

#include "base/ntios_types.h"
#include "syscalls/ntios_conv.h"
#include "syscalls/ntios_strman.h"
#include "syscalls/ntios_md5.h"



/* GLOBAL VARIABLES */
md5_ctx md5_ctx_bckup;
const char *bckup_hash_ptr;
U32 bckup_str_len;



/* NAME SPACE */
namespace ntios {
namespace md5 {
    /*
    *********************************************************************
    * BASED ON RFC-1321: https://datatracker.ietf.org/doc/html/rfc1321
    *********************************************************************
    /* CONSTANTS */
    const U16 TB_STRLEN_LIMIT65K = 65535;
    const U8 TB_HASH_LIMIT_16 = 16;
    const char *const TB_EMPTYSTRING = "";


    /***********/
    /* PRIVATE */
    /***********/

    /* ARRAYS */
    static U8 padding_arr[] = {
        0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    };

    /* PRE-DEFINED FUNCTIONS */
    static void hmemcpy(void *dst_output, void *src_input, size_t len_input);
    static U8* string_to_u8ptr(const std::string &str);
    static void md5_init(md5_ctx *input_ctx);
    static void md5_update(md5_ctx *input_ctx, U8 *input, size_t input_len);
    static void md5_finish(md5_ctx *input_ctx, U8 *digest);
    static void md5_transform(U32 state[4], \
                                U8 block[64]);
    static void md5_encode(U8 *output, U32 *input, size_t len);
    static void md5_decode(U32 *output, U8 *input, size_t len);
    static void bckup_variables_init();
    static std::string md5_calc(const std::string &input, \
                                        const std::string &input_hash, \
                                            md5_modes md5_mode, \
                                                size_t total_len);



    /* FUNCTIONS */
    static void hmemcpy(void *dst_output, void *src_input, size_t len_input) {
        /* Type Cast */
        /*
        * Convert any type of pointer to 'char pointer'.
        */
        char *src_arr = reinterpret_cast<char *>(src_input);
        char *dst_arr = reinterpret_cast<char *>(dst_output);

        /* Copy contents of src_arr[] to dst_arr[] */
        for (U32 i = 0; i < len_input; i++) {
            dst_arr[i] = src_arr[i];
        }
    }

    static U8* string_to_u8ptr(const std::string &str) {
        /* Convert from 'string' to 'const char pointer' */
        const char *str_ptr = str.c_str();

        /* Convert from 'char pointer' to 'unsighed char pointer' */
        char *str_arr = const_cast<char*>(str_ptr);

        /* Output */
        return reinterpret_cast<U8*>(str_arr);
    }

    /* 
    * MD5-initialization:
    *   Begins an MD5 operation, writing a new input_ctx.
    */
    static void md5_init(md5_ctx *input_ctx) {
        input_ctx->count[0] = 0;
        input_ctx->count[1] = 0;
        input_ctx->state[0] = 0x67452301;
        input_ctx->state[1] = 0xEFCDAB89;
        input_ctx->state[2] = 0x98BADCFE;
        input_ctx->state[3] = 0x10325476;
    }

    /* 
    * MD5 block update operation. Continues an MD5 message-digest operation,
    * processing another message block, and updating the input_ctx.
    */
    static void md5_update(md5_ctx *input_ctx, U8 *input, size_t input_len) {
        /*
        * Input:
        *   input_ctx: input_ctx
        *   input: input block
        *   input_len: input block length
        */
        /* Define and Init variables */
        U32 i = 0;
        U32 index = 0;
        U32 partlen = 0;

        /* Compute number of bytes mod 64 */
        index = (input_ctx->count[0] >> 3) & 0x3F;

        /* Update number of bits */
        input_ctx->count[0] += input_len << 3;
        if (input_ctx->count[0] < (input_len << 3)) {
            input_ctx->count[1]++;
        }
        input_ctx->count[1] += input_len >> 29;

        /* 
        * Transform as many times as possible.
        */ 
        partlen = 64 - index;
        if (input_len >= partlen) {
            hmemcpy(&input_ctx->buffer[index], \
                    input, partlen);

            md5_transform(input_ctx->state, input_ctx->buffer);

            for (i = partlen; \
                    i + 64 <= input_len;
                        i += 64) {
                md5_transform(input_ctx->state, &input[i]);
            }

            index = 0;
        } else {
            i = 0;
        }

        /*
        * Buffer remaining input
        */
        hmemcpy(&input_ctx->buffer[index], \
                &input[i], \
                    input_len - i);
    }

    /* 
    * MD5 finalization. Ends an MD5 message-digest operation, writing the
    * the message digest and zeroizing the input_ctx.
    */
    static void md5_finish(md5_ctx *input_ctx, U8 *digest) {
        /*
        * Input:
        *   input_ctx: input_ctx
        *   digest: message digest
        */
        U32 index = 0;
        U32 padlen = 0;
        U8 bits[8];

        /* Save number of bits */
        md5_encode(bits, input_ctx->count, 8);

        /* Pad out to 56 mod 64 */
        index = (input_ctx->count[0] >> 3) & 0x3F;
        padlen = (index < 56) ? (56 - index) : (120 - index);
        md5_update(input_ctx, padding_arr, padlen);

        /* Append length (before padding) */
        md5_update(input_ctx, bits, 8);

        /* Store state in digest */
        md5_encode(digest, input_ctx->state, TB_HASH_LIMIT_16);
    }


    /*
    * Encodes input (UINT4) into output (unsigned char).
    * Assumes len is a multiple of 4.
    * Remark:
    *   this function is called within md5_finish.
    */ 
    static void md5_encode(U8 *output, U32 *input, size_t len) {
        U32 i = 0;
        U32 j = 0;

        while (j < len) {
            output[j] = input[i] & 0xFF;
            output[j + 1] = (input[i] >> 8) & 0xFF;
            output[j + 2] = (input[i] >> 16) & 0xFF;
            output[j + 3] = (input[i] >> 24) & 0xFF;

            i++;
            j += 4;
        }
    }

    /*
    * Decodes input (unsigned char) into output (UINT4).
    * Assumes len is a multiple of 4.
    * Remark:
    *   this function is called within md5_transform.
    */ 
    static void md5_decode(U32 *output, U8 *input, size_t len) {
        U32 i = 0;
        U32 j = 0;

        while (j < len) {
            output[i] = (input[j]) |
            (input[j + 1] << 8) |
            (input[j + 2] << 16) |
            (input[j + 3] << 24);

            i++;
            j += 4;
        }
    }

    /*
    * MD5 basic transformation. Transforms state based on block.
    * Remark:
    *   this function is called within md5_update.
    */
    static void md5_transform(U32 state[4], U8 block[64]) {
        U32 a = state[0];
        U32 b = state[1];
        U32 c = state[2];
        U32 d = state[3];
        U32 x[64];

        md5_decode(x, block, 64);
        FF(a, b, c, d, x[0], 7, 0xd76aa478);
        FF(d, a, b, c, x[1], 12, 0xe8c7b756);
        FF(c, d, a, b, x[2], 17, 0x242070db);
        FF(b, c, d, a, x[3], 22, 0xc1bdceee);
        FF(a, b, c, d, x[4], 7, 0xf57c0faf);
        FF(d, a, b, c, x[5], 12, 0x4787c62a);
        FF(c, d, a, b, x[6], 17, 0xa8304613);
        FF(b, c, d, a, x[7], 22, 0xfd469501);
        FF(a, b, c, d, x[8], 7, 0x698098d8);
        FF(d, a, b, c, x[9], 12, 0x8b44f7af);
        FF(c, d, a, b, x[10], 17, 0xffff5bb1);
        FF(b, c, d, a, x[11], 22, 0x895cd7be);
        FF(a, b, c, d, x[12], 7, 0x6b901122);
        FF(d, a, b, c, x[13], 12, 0xfd987193);
        FF(c, d, a, b, x[14], 17, 0xa679438e);
        FF(b, c, d, a, x[15], 22, 0x49b40821);

        GG(a, b, c, d, x[1], 5, 0xf61e2562);
        GG(d, a, b, c, x[6], 9, 0xc040b340);
        GG(c, d, a, b, x[11], 14, 0x265e5a51);
        GG(b, c, d, a, x[0], 20, 0xe9b6c7aa);
        GG(a, b, c, d, x[5], 5, 0xd62f105d);
        GG(d, a, b, c, x[10], 9, 0x2441453);
        GG(c, d, a, b, x[15], 14, 0xd8a1e681);
        GG(b, c, d, a, x[4], 20, 0xe7d3fbc8);
        GG(a, b, c, d, x[9], 5, 0x21e1cde6);
        GG(d, a, b, c, x[14], 9, 0xc33707d6);
        GG(c, d, a, b, x[3], 14, 0xf4d50d87);
        GG(b, c, d, a, x[8], 20, 0x455a14ed);
        GG(a, b, c, d, x[13], 5, 0xa9e3e905);
        GG(d, a, b, c, x[2], 9, 0xfcefa3f8);
        GG(c, d, a, b, x[7], 14, 0x676f02d9);
        GG(b, c, d, a, x[12], 20, 0x8d2a4c8a);

        HH(a, b, c, d, x[5], 4, 0xfffa3942);
        HH(d, a, b, c, x[8], 11, 0x8771f681);
        HH(c, d, a, b, x[11], 16, 0x6d9d6122);
        HH(b, c, d, a, x[14], 23, 0xfde5380c);
        HH(a, b, c, d, x[1], 4, 0xa4beea44);
        HH(d, a, b, c, x[4], 11, 0x4bdecfa9);
        HH(c, d, a, b, x[7], 16, 0xf6bb4b60);
        HH(b, c, d, a, x[10], 23, 0xbebfbc70);
        HH(a, b, c, d, x[13], 4, 0x289b7ec6);
        HH(d, a, b, c, x[0], 11, 0xeaa127fa);
        HH(c, d, a, b, x[3], 16, 0xd4ef3085);
        HH(b, c, d, a, x[6], 23, 0x4881d05);
        HH(a, b, c, d, x[9], 4, 0xd9d4d039);
        HH(d, a, b, c, x[12], 11, 0xe6db99e5);
        HH(c, d, a, b, x[15], 16, 0x1fa27cf8);
        HH(b, c, d, a, x[2], 23, 0xc4ac5665);

        II(a, b, c, d, x[0], 6, 0xf4292244);
        II(d, a, b, c, x[7], 10, 0x432aff97);
        II(c, d, a, b, x[14], 15, 0xab9423a7);
        II(b, c, d, a, x[5], 21, 0xfc93a039);
        II(a, b, c, d, x[12], 6, 0x655b59c3);
        II(d, a, b, c, x[3], 10, 0x8f0ccc92);
        II(c, d, a, b, x[10], 15, 0xffeff47d);
        II(b, c, d, a, x[1], 21, 0x85845dd1);
        II(a, b, c, d, x[8], 6, 0x6fa87e4f);
        II(d, a, b, c, x[15], 10, 0xfe2ce6e0);
        II(c, d, a, b, x[6], 15, 0xa3014314);
        II(b, c, d, a, x[13], 21, 0x4e0811a1);
        II(a, b, c, d, x[4], 6, 0xf7537e82);
        II(d, a, b, c, x[11], 10, 0xbd3af235);
        II(c, d, a, b, x[2], 15, 0x2ad7d2bb);
        II(b, c, d, a, x[9], 21, 0xeb86d391);
        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
    }

    static void bckup_variables_init() {
        md5_ctx_bckup = {0};
        bckup_hash_ptr = TB_EMPTYSTRING;
        bckup_str_len = 0;
    }

    static std::string md5_calc(const std::string &input, \
                                    const std::string &input_hash, \
                                        md5_modes md5_mode, \
                                            size_t total_len) {
        /*
        Method:
            Generates MD5 hash on the specified string input 'str'.
        Input:
        - str: string containing (the next portion of) the input 
                data to generate MD5 hash on.
            Remarks:
            1. Maximum String-length is 65535. If the length is exceeded, 
                then this will result in an Error and the function will 
                return an Empty String. 
            2. md5_mode = 0- MD5_UPDATE → String-length must be Divisible 
                by 64 (e.g. 64, 128, 192, etc. characters in length).
                
                *NOTE*: any other length will result in an Error, and the 
                    function will return an Empty String. 
            3. md5_mode= 1- MD5_FINISH → this string can have any length 
                (up to 65535 characters).
        - input_hash: hash obtained as a result of MD5 calculation on 
                the previous data portion. 
                
                *IMPORTANT*:
                1. (MUST) Set to Empty String for the FIRST PORTION of data.
                2. (MUST) Use the Result of the previous MD5 calculation 
                    for the second and all subsequent portions of data.
                3. The result of MD5 is ALWAYS 16 characters long. 
                
                Remarks: 
                1. passing an input_hash of any other length 
                    (e.g. input_hash = "1"), except for an Empty String, will 
                    result in Error; this function will return an Empty String.
                2. passing an input_hash of 16 characters long, but NOT from 
                    the result of the previous MD5 calculation, will result in the
                    return of an EMPTY STRING.
                3. using the input_hash of the previous calculation is important, 
                    because this value can be used to validate whether the 
                    MD5-calculation is being done on the same string 'str' or not. 
        - md5_mode: 
            0- MD5_UPDATE : Set this mode for all data portions except for:
                1. the Last data portion (see MD5_FINISH)
                2. if you have a single data portion (see MD5_FINISH)
            1- MD5_FINISH: The MD5 calculation ALWAYS ENDS with this mode.
                    When to use this mode?
                      1. when calculating the Last Data Portion
                      2. In case we only have a SINGLE DATA Portion.
                
                *NOTE*: in this case, set the input_hash as an Empty String.
        - total_len: total length of processed data (of all data portions combined). 
            Remarks:
            1. Only relevant when md5_mode = 1- MD5_FINISH. 
            2. Only relevant for the last or a single data portion.
            3. If the input total length does NOT match the 'real' total length 
                of the processed data, then this will result in the
                    return of an EMPTY STRING.
        Output:
            16-character hash string
        Remarks:
            1. MD5 is a standard method of calculating hash codes on data of any size. 
            2. The amount of input data can often exceed the maximum capacity of 
                string variables (65535 characters). The md5 method can be invoked 
                repeatedly in order to process the data of any size (see the example below).
        */

        /* Define variables */
        md5_ctx input_ctx;
        U8 *input_hex;
        U8 hash_arr[TB_HASH_LIMIT_16];
        U8 hash_arr_item;
        U32 input_hash_len;
        U32 input_hex_len, input_hex_len_mod;
        std::string hash_output, hash_str_item;
        const char *input_hash_ptr;

        /* Convert 'string' to 'const char pointer' */
        input_hash_ptr = input_hash.c_str();

        /* Convert 'string' to 'unsigned char pointer' */
        input_hex = string_to_u8ptr(input);

        /* Get string-length of 'input' */
        input_hex_len = ntios::strman::len(input);

        /* 
        * Check if string-length of 'input' has exceeded 
        * the maximum allowed (65535)
        */
        if (input_hex_len > TB_STRLEN_LIMIT65K) {
            bckup_variables_init();

            return TB_EMPTYSTRING;
        }

        /* 
        * Validate string-length modulus
        * Must be divisible by 64 for md5_mode = MD5_UPDATE
        */
        if (md5_mode == MD5_UPDATE) {
            /* Get modulus value */
            input_hex_len_mod = (input_hex_len%64);

            /* In case NOT divisible by 64, then return an EMPTYSTRING */
            if (input_hex_len_mod != 0) {
            bckup_variables_init();

            return TB_EMPTYSTRING;
            }
        }

        /* INIT */
        if (input_hash == TB_EMPTYSTRING) {
            /* initialize 'input_ctx' */
            md5_init(&input_ctx);

            /* Initialize backup variables */
            bckup_variables_init();
        } else {
            /* Get the length of 'input_hash' */
            input_hash_len = ntios::strman::len(input_hash);

            /* 
            * Validate 'input_hash' string-length 
            */
            /* 16 characters long */
            if (input_hash_len == TB_HASH_LIMIT_16) {
                /* input value does NOT match the backup value */
                if ((input_hash_ptr) != bckup_hash_ptr) {
                    bckup_variables_init();

                    return TB_EMPTYSTRING;
                }

            /* Not 16 characters long */
            } else {
                bckup_variables_init();

                return TB_EMPTYSTRING;
            }

            /* 
            * Update current context 'input_ctx' with the backed up context 'md5_ctx_bckup'
            */
            input_ctx = md5_ctx_bckup;
        }

        /*
        * Backup string-length of 'input'
        * Remark:
        *   This is important because it will be used for 
        *   the END-validation when md5_mode = MD5_FINISH
        */
        bckup_str_len = bckup_str_len + input_hex_len;

        /*
        * Validate the total length of processed data
        */
        if (md5_mode == MD5_FINISH) {
            if (total_len != bckup_str_len) {
                bckup_variables_init();

                return TB_EMPTYSTRING;
            }
        }

        /* UPDATE */
        /*
        * MD5 block update operation. Continues an MD5 message-digest operation,
        * processing another message block, and updating the input_ctx.
        */
        md5_update(&input_ctx, input_hex, input_hex_len);

        /* Backup context */
        if (md5_mode == MD5_UPDATE) {
            md5_ctx_bckup = input_ctx;
        }

        /* FINISH */
        /*
        * MD5 finalization. Ends an MD5 message-digest operation, writing the
        * the message digest and zeroizing the input_ctx.
        */
        if (md5_mode == MD5_FINISH) {
            /* Finalize MD5 */
            md5_finish(&input_ctx, hash_arr);

            /* Initialize Backup Variables */
            bckup_variables_init();
        }

        /*
        * Convert Hex to String
        * Remark:
        *   Variable 'hash_arr' contains 16 hex-values
        */
        hash_output = TB_EMPTYSTRING;    /* Initialize */
        for (U8 i = 0; i < TB_HASH_LIMIT_16; i++) {
            /* Get each asc-value */
            hash_arr_item = hash_arr[i];

            /* Convert Hex to String */
            hash_str_item = ntios::conv::chr(hash_arr_item);

            /* Add to output variable */
            hash_output = hash_output + hash_str_item;
        }



        /* Backup 'hash_output' */
        if (md5_mode == MD5_UPDATE) {
            bckup_hash_ptr = hash_output.c_str();
        }



        /* Output */
        return hash_output;
    }


    /**********/
    /* PUBLIC */
    /**********/
    std::string md5(const std::string &str, \
                        const std::string &input_hash, \
                            md5_modes md5_mode, U32 total_len) {
        /*
        Method:
            Generates MD5 hash on the specified string input 'str'.
        Input:
            str: string containing (the next portion of) the input 
                data to generate MD5 hash on.
            input_hash: hash obtained as a result of MD5 calculation on 
                the previous data portion. 
            md5_mode: 
                0-MD5_UPDATE : Set this mode for all data portions except for:
                    1. the Last data portion (see MD5_FINISH)
                    2. if you have a single data portion (see MD5_FINISH)
                1-MD5_FINISH: The MD5 calculation ALWAYS ENDS with this mode.
            total_len: total length of processed data (of all data portions combined).
        Output:
            16-character hash string
        */

        return md5_calc(str, input_hash, md5_mode, total_len);
    }

}  // namespace md5
}  // namespace ntios
