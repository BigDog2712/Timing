package com.timing.app.native

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * WebDAV 应用密码的加密存储（V0.11.13）。
 *
 * ## 为什么不进 SharedPreferences 明文
 *
 * `TimingNativePlugin` 的其余偏好（SAF 目录、悬浮条坐标）都是无害的设备本地状态，
 * 明文放在 `timing-native` 里没问题。应用密码不一样：它等同账号凭证，而
 * `SharedPreferences` 在 root 过的机器上是可直接读的文本。
 *
 * ## 密钥在哪
 *
 * AES 密钥由 Android Keystore 生成并保管，**永远不出 Keystore**（这里拿到的只是句柄），
 * 所以把 `timing-secret` 文件拷走也解不开。`setUserAuthenticationRequired(false)` 是必须的：
 * 后台同步不能弹指纹/密码框，否则一轮同步会挂在那里等用户。
 *
 * ## 落盘格式
 *
 * `Base64( 1 字节 IV 长度 | IV | GCM 密文+tag )`，键名由 Rust 侧给（目前只有 `webdav`）。
 * IV 长度写进第一个字节而不是写死 12：换机型/换 provider 时 IV 长度可能不同，
 * 写死会在解密时偏移错位，而错位只会报一句 `AEADBadTagException`。
 *
 * 全部方法都在调用线程上同步执行：Keystore 与一个几 KB 的密文都是毫秒级，
 * 为此拉一条协程只会让 `Invoke` 的生命周期更难管。
 */
object SecretStore {

    private const val FILE = "timing-secret"
    private const val ALIAS = "timing-secret-key"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
    private const val MIN_IV = 8

    fun put(ctx: Context, key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val sealed = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = ByteArray(1 + iv.size + sealed.size)
        payload[0] = iv.size.toByte()
        System.arraycopy(iv, 0, payload, 1, iv.size)
        System.arraycopy(sealed, 0, payload, 1 + iv.size, sealed.size)
        /* `commit` 而不是 `apply`：写完这条命令就要能立刻读回来（下一轮同步马上要用），
        apply 的异步窗口里进程被杀等于没存。 */
        prefs(ctx).edit()
            .putString(key, Base64.encodeToString(payload, Base64.NO_WRAP))
            .commit()
    }

    /** `null` = 没存过。解不开一律抛，由调用方折成一句人话（绝不返回空串冒充"没存过"）。 */
    fun get(ctx: Context, key: String): String? {
        val raw = prefs(ctx).getString(key, null) ?: return null
        val payload = Base64.decode(raw, Base64.NO_WRAP)
        require(payload.isNotEmpty()) { "密文是空的" }
        val ivSize = payload[0].toInt() and 0xFF
        require(ivSize >= MIN_IV && payload.size > 1 + ivSize) { "密文长度不对" }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(TAG_BITS, payload, 1, ivSize),
        )
        return String(
            cipher.doFinal(payload, 1 + ivSize, payload.size - 1 - ivSize),
            Charsets.UTF_8,
        )
    }

    /** 删不存在的键算成功：界面上连按两次「清除」不该弹错。 */
    fun clear(ctx: Context, key: String) {
        prefs(ctx).edit().remove(key).commit()
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** 首次调用时生成密钥；之后从 Keystore 取回同一把。 */
    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }
}
