package com.example.smart_glove_with_bluetooth

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import java.io.InputStream
import java.util.*

class MainActivity : ComponentActivity() {

    private lateinit var bluetoothAdapter: BluetoothAdapter
    private var socket: BluetoothSocket? = null
    private lateinit var tts: TextToSpeech

    private val UUID_SPP: UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private val discoveredDevices = mutableStateListOf<BluetoothDevice>()

    private val discoveryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val device: BluetoothDevice? =
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    device?.let {
                        if (!discoveredDevices.contains(it)) {
                            discoveredDevices.add(it)
                        }
                    }
                }
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                    isScanning.value = false
                }
            }
        }
    }

    private var isScanning = mutableStateOf(false)
    private var isConnecting = mutableStateOf(false)
    private var connectedDeviceName = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter()
        tts = TextToSpeech(this) { tts.language = Locale.US }

        // Permissions
        val permissions = mutableListOf(
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        )
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }

        val requestPermissionLauncher =
            registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { perms ->
            }

        requestPermissionLauncher.launch(permissions.toTypedArray())

        // Register discovery receiver
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        registerReceiver(discoveryReceiver, filter)

        // Load paired devices initially
        discoveredDevices.clear()
        discoveredDevices.addAll(bluetoothAdapter.bondedDevices)

        setContent {
            BluetoothDeviceListScreen()
        }
    }

    @Composable
    fun BluetoothDeviceListScreen() {
        var status by remember { mutableStateOf("Disconnected") }
        var log by remember { mutableStateOf("") }

        Column(modifier = Modifier.padding(16.dp)) {
            Text("Status: $status")
            Spacer(modifier = Modifier.height(16.dp))

            // Scan Button
            Button(
                onClick = { startScan() },
                enabled = !isScanning.value && !isConnecting.value
            ) {
                if (isScanning.value) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Scanning...")
                } else {
                    Text("Scan for Devices")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text("Select a device to connect:")

            Spacer(modifier = Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier.height(300.dp)
            ) {
                items(discoveredDevices) { device ->
                    val type = when (device.type) {
                        BluetoothDevice.DEVICE_TYPE_CLASSIC -> "Classic"
                        BluetoothDevice.DEVICE_TYPE_LE -> "BLE"
                        BluetoothDevice.DEVICE_TYPE_DUAL -> "Dual"
                        else -> "Unknown"
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${device.name ?: "Unknown"}")
                            Text(device.address)
                            Text("Type: $type")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = {
                                connectToDevice(device,
                                    onStatus = { status = it },
                                    onMessage = {
                                        log += "\n$it"
                                        tts.speak(it, TextToSpeech.QUEUE_ADD, null, null)
                                    })
                            },
                            enabled = !isConnecting.value
                        ) {
                            if (isConnecting.value && connectedDeviceName.value == device.name) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Connecting...")
                            } else {
                                Text("Connect")
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text("Received Data:")
            Spacer(modifier = Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
            ) {
                items(log.split("\n").filter { it.isNotEmpty() }) { message ->
                    Text(message)
                }
            }
        }
    }

    private fun startScan() {
        if (ActivityCompat.checkSelfPermission(
                this,
                Manifest.permission.BLUETOOTH_SCAN
            ) != PackageManager.PERMISSION_GRANTED
        ) return

        discoveredDevices.clear()
        discoveredDevices.addAll(bluetoothAdapter.bondedDevices)

        isScanning.value = true
        bluetoothAdapter.startDiscovery()
    }

    private fun connectToDevice(
        device: BluetoothDevice,
        onStatus: (String) -> Unit,
        onMessage: (String) -> Unit
    ) {
        isConnecting.value = true
        connectedDeviceName.value = device.name

        Thread {
            try {
                runOnUiThread { onStatus("Connecting to ${device.name}...") }

                if (ActivityCompat.checkSelfPermission(
                        this,
                        Manifest.permission.BLUETOOTH_CONNECT
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    runOnUiThread { onStatus("Permission denied") }
                    isConnecting.value = false
                    return@Thread
                }

                socket = device.createRfcommSocketToServiceRecord(UUID_SPP)

                if (ActivityCompat.checkSelfPermission(
                        this,
                        Manifest.permission.BLUETOOTH_SCAN
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    bluetoothAdapter.cancelDiscovery()
                }

                socket?.connect()
                runOnUiThread { onStatus("Connected to ${device.name}") }
                startReading(onStatus, onMessage)

            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread { onStatus("Connection Failed") }
            } finally {
                isConnecting.value = false
            }
        }.start()
    }

    private fun startReading(
        onStatus: (String) -> Unit,
        onMessage: (String) -> Unit
    ) {
        Thread {
            try {
                val inputStream: InputStream? = socket?.inputStream
                val buffer = ByteArray(1024)
                var bytes: Int

                while (true) {
                    bytes = inputStream?.read(buffer) ?: -1
                    if (bytes > 0) {
                        val message = String(buffer, 0, bytes).trim()
                        runOnUiThread { onMessage(message) }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread { onStatus("Disconnected") }
            }
        }.start()
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(discoveryReceiver)
        try {
            socket?.close()
            tts.shutdown()
        } catch (_: Exception) {}
    }
}