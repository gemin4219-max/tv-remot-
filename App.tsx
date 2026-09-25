import { StatusBar } from 'expo-status-bar';
import React, { useState, useRef, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  FlatList,
  Animated,
  Easing,
  Modal
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons, Ionicons, Feather } from '@expo/vector-icons';
import * as Network from 'expo-network';

type TVDevice = {
  ip: string;
  brand: string;
  name: string;
};

export default function App() {
  const [activeScreen, setActiveScreen] = useState<'SPLASH' | 'SCANNER' | 'REMOTE'>('SPLASH');
  
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevices, setFoundDevices] = useState<TVDevice[]>([]);
  const [showIpModal, setShowIpModal] = useState(false);
  const [manualIp, setManualIp] = useState('');

  const [selectedTV, setSelectedTV] = useState<TVDevice | null>(null);
  const [connectionMode, setConnectionMode] = useState<'WIFI' | 'BLUETOOTH' | 'IR'>('WIFI');
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const textInputRef = useRef<TextInput>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const isScanningRef = useRef(false);

  // Splash Screen Animations
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.8)).current;

  // Run Splash Screen
  useEffect(() => {
    if (activeScreen === 'SPLASH') {
      Animated.parallel([
        Animated.timing(splashOpacity, {
          toValue: 1,
          duration: 1000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.spring(splashScale, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        })
      ]).start(() => {
        setTimeout(() => {
          Animated.timing(splashOpacity, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }).start(() => {
            setActiveScreen('SCANNER');
          });
        }, 1200);
      });
    }
  }, [activeScreen]);

  // Handle Scanning Animation & Haptics
  useEffect(() => {
    if (isScanning) {
      // Start visual radar pulse
      Animated.loop(
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 2.2,
            duration: 1200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 1200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();

      // Haptic heartbeat loop (replaces sound for Expo Go compatibility)
      const hapticInterval = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      }, 1200);

      return () => clearInterval(hapticInterval);

    } else {
      // Stop animation
      pulseAnim.setValue(1);
      fadeAnim.setValue(1);
      Animated.timing(pulseAnim).stop();
    }
  }, [isScanning]);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const startScan = async () => {
    triggerHaptic();
    setIsScanning(true);
    isScanningRef.current = true;
    setFoundDevices([]);

    try {
      const ipAddress = await Network.getIpAddressAsync();
      if (!ipAddress || ipAddress === '0.0.0.0') {
        alert('Could not find Wi-Fi connection.');
        setIsScanning(false);
        isScanningRef.current = false;
        return;
      }

      const ipParts = ipAddress.split('.');
      ipParts.pop(); 
      const subnet = ipParts.join('.') + '.';
      
      const startTime = Date.now();

      // Continuous sweep for up to 60 seconds
      while (isScanningRef.current && (Date.now() - startTime) < 60000) {
        
        // Batch scanning to prevent React Native from dropping network requests
        const batchSize = 40; 
        for (let i = 1; i <= 255; i += batchSize) {
          if (!isScanningRef.current) break; // abort loop if stopped
          
          const batchPromises = [];
          for (let j = 0; j < batchSize && (i + j) <= 255; j++) {
            const targetIp = subnet + (i + j);
            batchPromises.push(
              pingTV(targetIp, i + j).then(device => {
                if (device) {
                  setFoundDevices(prev => {
                    if (prev.find(d => d.ip === device.ip)) return prev;
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    return [...prev, device];
                  });
                }
              })
            );
          }
          
          await Promise.allSettled(batchPromises);
        }

        // Wait a brief moment before the next full subnet sweep
        if (isScanningRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    } catch (error) {
      console.log('Scan error', error);
    }
    
    setIsScanning(false);
    isScanningRef.current = false;
  };

  const stopScan = () => {
    isScanningRef.current = false;
    setIsScanning(false);
  };

  const pingTV = async (ip: string, index: number): Promise<TVDevice | null> => {
    return new Promise((resolve) => {
      let resolved = false;

      const finish = (device: TVDevice | null) => {
        if (!resolved) {
          resolved = true;
          resolve(device);
        }
      };

      // 1. Check Roku (8060)
      const cRoku = new AbortController();
      const tRoku = setTimeout(() => cRoku.abort(), 1200);
      fetch(`http://${ip}:8060/query/device-info`, { signal: cRoku.signal })
        .then(() => { clearTimeout(tRoku); finish({ ip, brand: 'Roku', name: 'Roku TV' }); })
        .catch(() => {});

      // 2. Check Samsung (8001)
      const cSam = new AbortController();
      const tSam = setTimeout(() => cSam.abort(), 1200);
      fetch(`http://${ip}:8001/api/v2/`, { signal: cSam.signal })
        .then(() => { clearTimeout(tSam); finish({ ip, brand: 'Samsung', name: 'Samsung TV' }); })
        .catch(() => {});

      // 3. Check Android TV / Sony / Chromecast (8008)
      const cAnd = new AbortController();
      const tAnd = setTimeout(() => cAnd.abort(), 1200);
      fetch(`http://${ip}:8008/setup/eureka_info`, { signal: cAnd.signal })
        .then(() => { clearTimeout(tAnd); finish({ ip, brand: 'Android TV', name: 'Android Smart TV' }); })
        .catch(() => {});

      // 4. Check Apple TV (3689)
      const cApp = new AbortController();
      const tApp = setTimeout(() => cApp.abort(), 1200);
      fetch(`http://${ip}:3689/server-info`, { signal: cApp.signal })
        .then(() => { clearTimeout(tApp); finish({ ip, brand: 'Apple TV', name: 'Apple TV' }); })
        .catch(() => {});

      // 5. Check LG WebOS (3000) via WebSocket
      try {
        const ws = new WebSocket(`ws://${ip}:3000`);
        const wsTimeout = setTimeout(() => {
          if (!resolved && ws.readyState !== 1) ws.close();
        }, 1200);
        ws.onopen = () => {
          clearTimeout(wsTimeout);
          finish({ ip, brand: 'LG', name: 'LG WebOS TV' });
          ws.close();
        };
        ws.onerror = () => {};
      } catch (e) {}

      // 6. Check Hisense VIDAA (36866)
      const cHis = new AbortController();
      const tHis = setTimeout(() => cHis.abort(), 1200);
      fetch(`http://${ip}:36866/`, { signal: cHis.signal })
        .then(() => { clearTimeout(tHis); finish({ ip, brand: 'Hisense', name: 'Hisense VIDAA TV' }); })
        .catch(() => {});

      // Fallback timeout if nothing responds
      setTimeout(() => finish(null), 1300);
    });
  };

  const handleKeyPress = async (key: string) => {
    triggerHaptic();
    if (connectionMode === 'WIFI' && selectedTV) {
      console.log(`Sending command: ${key} to ${selectedTV.brand} at ${selectedTV.ip}`);
      
      try {
        if (selectedTV.brand === 'Hisense') {
          // Hisense typically uses Port 36866 or MQTT on 1883.
          // Sending a standard HTTP REST payload (some models accept this over 36866).
          await fetch(`http://${selectedTV.ip}:36866/remoteControl/keypress/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => null); // Ignoring errors in Expo Go
        } 
        else if (selectedTV.brand === 'Roku') {
          // Roku uses a standard REST API on port 8060
          await fetch(`http://${selectedTV.ip}:8060/keypress/${key}`, { method: 'POST' }).catch(() => null);
        }
        else {
          // Generic WebOS / Android TV fallback
          await fetch(`http://${selectedTV.ip}:8001/api/v2/channels/samsung.remote.control`, {
            method: 'POST',
            body: JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key } })
          }).catch(() => null);
        }
      } catch (err) {
        console.log('Network error sending key:', err);
      }
    }
  };

  const toggleKeyboard = () => {
    triggerHaptic();
    if (isKeyboardVisible) {
      Keyboard.dismiss();
      setKeyboardVisible(false);
    } else {
      setKeyboardVisible(true);
      setTimeout(() => textInputRef.current?.focus(), 100);
    }
  };


  if (activeScreen === 'SPLASH') {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <Animated.View style={{ opacity: splashOpacity, transform: [{ scale: splashScale }], alignItems: 'center' }}>
          <View style={{ width: 110, height: 110, borderRadius: 35, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center', marginBottom: 25 }}>
            <Feather name="tv" size={55} color="#fff" />
          </View>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 1 }}>UNI<Text style={{color: '#3b82f6'}}>REMOTE</Text></Text>
          <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '700', marginTop: 12, textTransform: 'uppercase', letterSpacing: 3 }}>Universal Control</Text>
        </Animated.View>
      </View>
    );
  }

  if (activeScreen === 'SCANNER') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.scannerContainer}>
          
          <View style={styles.centerBlock}>
            <View style={styles.radarWrapper}>
              {isScanning && (
                <Animated.View 
                  style={[
                    styles.radarPulse, 
                    { 
                      transform: [{ scale: pulseAnim }], 
                      opacity: fadeAnim 
                    }
                  ]} 
                />
              )}
              <View style={styles.radarCore}>
                <MaterialCommunityIcons name="broadcast" size={50} color="#3b82f6" />
              </View>
            </View>

            <Text style={styles.title}>Scan Network</Text>
            <Text style={styles.subtitle}>Looking for Smart TVs on your Wi-Fi</Text>

            {isScanning ? (
              <View style={styles.scanningState}>
                <Text style={styles.scanningText}>Sweeping network... (Up to 60s)</Text>
                
                <TouchableOpacity 
                  style={{marginTop: 15}}
                  onPress={() => {
                    triggerHaptic();
                    stopScan();
                  }}
                >
                  <Text style={{color: '#ef4444', fontWeight: '600', fontSize: 15}}>Stop Scan</Text>
                </TouchableOpacity>

              </View>
            ) : (
              <TouchableOpacity style={styles.scanButton} onPress={startScan}>
                <MaterialCommunityIcons name="radar" size={24} color="#fff" style={{marginRight: 10}} />
                <Text style={styles.scanButtonText}>Tap to Scan</Text>
              </TouchableOpacity>
            )}
          </View>

          {foundDevices.length > 0 && (
            <View style={styles.listContainer}>
              <FlatList
                data={foundDevices}
                keyExtractor={(item) => item.ip}
                style={styles.deviceList}
                contentContainerStyle={{ paddingBottom: 20 }}
                ListHeaderComponent={() => (
                  <Text style={styles.listHeader}>Available Devices</Text>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.deviceCard}
                    activeOpacity={0.7}
                    onPress={() => {
                      triggerHaptic();
                      stopScan(); // Instantly aborts the 60s loop
                      setSelectedTV(item);
                      setActiveScreen('REMOTE');
                    }}
                  >
                    <View style={styles.deviceIconBg}>
                      <Feather name="tv" size={24} color="#3b82f6" />
                    </View>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>{item.name}</Text>
                      <Text style={styles.deviceIp}>{item.ip}</Text>
                    </View>
                    <View style={styles.connectPill}>
                      <Text style={styles.connectText}>Connect</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {!isScanning && foundDevices.length === 0 && (
             <TouchableOpacity 
               style={styles.skipLinkContainer}
               onPress={() => {
                 triggerHaptic();
                 setShowIpModal(true);
               }}
             >
                <Text style={styles.skipLink}>Enter IP Manually / Skip</Text>
             </TouchableOpacity>
          )}
        </View>

        {/* Manual IP Modal */}
        <Modal visible={showIpModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Connect Manually</Text>
              <Text style={styles.modalDesc}>Some TVs (like Hisense) use encrypted connections that hide them from radar. Enter the IP directly.</Text>
              
              <TextInput 
                style={styles.modalInput}
                placeholder="e.g. 192.168.100.102"
                placeholderTextColor="#475569"
                value={manualIp}
                onChangeText={setManualIp}
                keyboardType="numeric"
                autoFocus
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity onPress={() => setShowIpModal(false)} style={styles.modalBtn}>
                   <Text style={styles.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                   onPress={() => {
                     triggerHaptic();
                     setShowIpModal(false);
                     setSelectedTV({ ip: manualIp, brand: 'Hisense', name: 'Hisense TV' });
                     setActiveScreen('REMOTE');
                   }} 
                   style={[styles.modalBtn, {backgroundColor: '#3b82f6'}]}
                >
                   <Text style={[styles.modalBtnText, {color: '#fff'}]}>Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </View>
    );
  }

  // REMOTE STYLES REMAINS UNCHANGED
  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.innerContainer}>
          <StatusBar style="light" />
          
          <View style={styles.header}>
             <TouchableOpacity 
               style={styles.backButton} 
               onPress={() => {
                 triggerHaptic();
                 setActiveScreen('SCANNER');
               }}
             >
                <Feather name="chevron-left" size={28} color="#94a3b8" />
             </TouchableOpacity>
            <View style={{alignItems: 'center'}}>
               <Text style={styles.remoteTitle}>{selectedTV?.name}</Text>
               <Text style={styles.remoteSubtitle}>Connected • {selectedTV?.ip}</Text>
            </View>
            <View style={styles.modeContainer}>
              {(['WIFI', 'BLUETOOTH', 'IR'] as const).map(mode => (
                <TouchableOpacity 
                  key={mode} 
                  style={[styles.modeButton, connectionMode === mode && styles.modeButtonActive]}
                  onPress={() => {
                    triggerHaptic();
                    setConnectionMode(mode);
                  }}
                >
                  <Text style={[styles.modeText, connectionMode === mode && styles.modeTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.topControls}>
            <TouchableOpacity style={[styles.roundButton, styles.powerButton]} onPress={() => handleKeyPress('PowerOn')}>
              <MaterialCommunityIcons name="power" size={28} color="#f8fafc" />
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.roundButton} onPress={toggleKeyboard}>
              <MaterialCommunityIcons name={isKeyboardVisible ? "keyboard-off-outline" : "keyboard-outline"} size={28} color="#f8fafc" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.roundButton} onPress={() => handleKeyPress('VolumeMute')}>
              <Ionicons name="volume-mute" size={26} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.dpadContainer}>
            <TouchableOpacity style={[styles.dpadButton, styles.dpadUp]} onPress={() => handleKeyPress('Up')}>
              <Feather name="chevron-up" size={36} color="#f8fafc" />
            </TouchableOpacity>
            
            <View style={styles.dpadMiddleRow}>
              <TouchableOpacity style={[styles.dpadButton, styles.dpadLeft]} onPress={() => handleKeyPress('Left')}>
                <Feather name="chevron-left" size={36} color="#f8fafc" />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.dpadCenter} onPress={() => handleKeyPress('Select')}>
                <Text style={styles.dpadCenterText}>OK</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={[styles.dpadButton, styles.dpadRight]} onPress={() => handleKeyPress('Right')}>
                <Feather name="chevron-right" size={36} color="#f8fafc" />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity style={[styles.dpadButton, styles.dpadDown]} onPress={() => handleKeyPress('Down')}>
              <Feather name="chevron-down" size={36} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.bottomControls}>
            <View style={styles.verticalRocker}>
              <TouchableOpacity style={styles.rockerTop} onPress={() => handleKeyPress('VolumeUp')}>
                <Feather name="plus" size={26} color="#f8fafc" />
              </TouchableOpacity>
              <Text style={styles.rockerLabel}>VOL</Text>
              <TouchableOpacity style={styles.rockerBottom} onPress={() => handleKeyPress('VolumeDown')}>
                <Feather name="minus" size={26} color="#f8fafc" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.roundButton} onPress={() => handleKeyPress('Home')}>
              <Ionicons name="home-outline" size={26} color="#f8fafc" />
            </TouchableOpacity>

            <View style={styles.verticalRocker}>
              <TouchableOpacity style={styles.rockerTop} onPress={() => handleKeyPress('ChannelUp')}>
                <Feather name="chevron-up" size={26} color="#f8fafc" />
              </TouchableOpacity>
              <Text style={styles.rockerLabel}>CH</Text>
              <TouchableOpacity style={styles.rockerBottom} onPress={() => handleKeyPress('ChannelDown')}>
                <Feather name="chevron-down" size={26} color="#f8fafc" />
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            ref={textInputRef}
            style={styles.hiddenInput}
            onChangeText={(text) => {
              if (text.length > 0) {
                handleKeyPress(`KEY_${encodeURIComponent(text.slice(-1))}`);
              }
            }}
            onBlur={() => setKeyboardVisible(false)}
            autoCapitalize="none"
            autoCorrect={false}
          />

        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scannerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 25,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    flex: 1,
  },
  radarWrapper: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  radarCore: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  radarPulse: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#3b82f6',
    zIndex: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 40,
    fontSize: 15,
    lineHeight: 22,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scanningState: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  scanningText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  listContainer: {
    width: '100%',
    flex: 1,
    marginTop: 30,
  },
  deviceList: {
    width: '100%',
  },
  listHeader: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 15,
    marginLeft: 5,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  deviceIconBg: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  deviceIp: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '500',
  },
  connectPill: {
    backgroundColor: '#3b82f620',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  connectText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '700',
  },
  skipLinkContainer: {
    paddingVertical: 20,
    paddingBottom: 40,
  },
  skipLink: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1e293b',
    width: '100%',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalDesc: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    color: '#f8fafc',
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  modalBtnText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '700',
  },
  
  // REMOTE STYLES
  innerContainer: {
    flex: 1,
    paddingTop: 60,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    width: '100%',
    position: 'relative',
    marginBottom: 10,
  },
  backButton: {
    position: 'absolute',
    left: 15,
    top: 5,
    padding: 10,
    zIndex: 10,
  },
  remoteTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  remoteSubtitle: {
    color: '#10b981', 
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 20,
  },
  modeContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 5,
  },
  modeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 15,
  },
  modeButtonActive: {
    backgroundColor: '#3b82f6',
  },
  modeText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 12,
  },
  modeTextActive: {
    color: '#ffffff',
  },
  topControls: {
    flexDirection: 'row',
    width: '85%',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  roundButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  powerButton: {
    backgroundColor: '#ef4444',
    borderColor: '#dc2626',
  },
  dpadContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 40,
    width: 260,
    height: 260,
    backgroundColor: '#1e293b',
    borderRadius: 130,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dpadMiddleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 15,
  },
  dpadButton: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadUp: { position: 'absolute', top: 5 },
  dpadDown: { position: 'absolute', bottom: 5 },
  dpadLeft: { },
  dpadRight: { },
  dpadCenter: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  dpadCenterText: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  bottomControls: {
    flexDirection: 'row',
    width: '85%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  verticalRocker: {
    backgroundColor: '#1e293b',
    borderRadius: 35,
    width: 64,
    height: 150,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rockerTop: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rockerBottom: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rockerLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    marginVertical: 5,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  }
});
