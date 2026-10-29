package io.github.turiddus.charactervault

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.CRC32

/** 8.2.1: the PNG written by Genesis on the phone must stay a valid PNG and carry the prompt for the desktop. */
class GenesisPhoneTest {
    private fun chunk(type: String, data: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        val t = type.toByteArray(Charsets.US_ASCII)
        val crc = CRC32().apply { update(t); update(data) }.value
        out.write(byteArrayOf((data.size ushr 24).toByte(), (data.size ushr 16).toByte(), (data.size ushr 8).toByte(), data.size.toByte()))
        out.write(t); out.write(data)
        out.write(byteArrayOf((crc ushr 24).toByte(), (crc ushr 16).toByte(), (crc ushr 8).toByte(), crc.toByte()))
        return out.toByteArray()
    }

    private fun tinyPng(): ByteArray {
        val sig = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        val ihdr = byteArrayOf(0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0)
        val raw = byteArrayOf(0, 0)
        val deflater = java.util.zip.Deflater(); deflater.setInput(raw); deflater.finish()
        val buf = ByteArray(64); val n = deflater.deflate(buf)
        return sig + chunk("IHDR", ihdr) + chunk("IDAT", buf.copyOf(n)) + chunk("IEND", ByteArray(0))
    }

    private fun chunks(png: ByteArray): List<Pair<String, ByteArray>> {
        val list = ArrayList<Pair<String, ByteArray>>()
        var i = 8
        while (i < png.size) {
            val len = ((png[i].toInt() and 0xff) shl 24) or ((png[i + 1].toInt() and 0xff) shl 16) or
                ((png[i + 2].toInt() and 0xff) shl 8) or (png[i + 3].toInt() and 0xff)
            val type = String(png, i + 4, 4, Charsets.US_ASCII)
            val data = png.copyOfRange(i + 8, i + 8 + len)
            val crc = CRC32().apply { update(png, i + 4, 4 + len) }.value
            val stored = ((png[i + 8 + len].toLong() and 0xff) shl 24) or ((png[i + 9 + len].toLong() and 0xff) shl 16) or
                ((png[i + 10 + len].toLong() and 0xff) shl 8) or (png[i + 11 + len].toLong() and 0xff)
            assertEquals("CRC of $type", crc, stored)
            list.add(type to data)
            i += 12 + len
        }
        return list
    }

    @Test fun textChunksAfterHeader() {
        val prompt = "UNIVERSAL RANDOM CHARACTER GENESIS\nCHARACTER SPECIFICATION:\nGENRE: test — dash"
        val out = GenesisPhone.withText(tinyPng(), listOf("parameters" to "$prompt\nSteps: 1, Size: 1024x1536", "Software" to "Character Vault Genesis (phone)"))
        val list = chunks(out)
        assertEquals(listOf("IHDR", "tEXt", "tEXt", "IDAT", "IEND"), list.map { it.first })
        val text = String(list[1].second, Charsets.ISO_8859_1)
        assertTrue(text.startsWith("parameters\u0000UNIVERSAL"))
        assertTrue(text.endsWith("Steps: 1, Size: 1024x1536"))
        assertTrue(text.contains("test ? dash"))  // characters outside Latin-1 are replaced, never break the chunk
        File(System.getProperty("java.io.tmpdir"), "cv_genesis_phone_test.png").writeBytes(out)
    }

    @Test fun nonPngIsUntouched() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3)
        assertArrayEquals(jpeg, GenesisPhone.withText(jpeg, listOf("parameters" to "x")))
    }

    @Test fun keyFormat() {
        assertTrue(GenesisPhone.validKey("sk-proj-" + "a".repeat(40)))
        assertTrue(!GenesisPhone.validKey("sk- with space " + "a".repeat(20)))
        assertTrue(!GenesisPhone.validKey("hello"))
    }
}
