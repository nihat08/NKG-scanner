import React, { useState, useRef, createContext, useContext } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, Image, ActivityIndicator, Alert, ScrollView, TextInput, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// HIER DEINEN KOPIERTEN OPENAI API KEY EINTRAGEN:
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

// --- 1. DAS APP-GEDÄCHTNIS (CONTEXT) ---
// Hier speichern wir die gesammelten Daten, damit alle Bildschirme darauf zugreifen können.
const AppContext = createContext<any>(null);

const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [driverId, setDriverId] = useState('');
  const [scannedCards, setScannedCards] = useState<any[]>([]);
  const [sessionAbfahrt, setSessionAbfahrt] = useState('');
  const [sessionZiel, setSessionZiel] = useState('');

  const addCard = (cardData: any) => {
    setScannedCards([...scannedCards, cardData]);
    setSessionAbfahrt(cardData.abfahrt || sessionAbfahrt);
    setSessionZiel(cardData.ziel || sessionZiel);
  };

  return (
    <AppContext.Provider value={{ driverId, setDriverId, scannedCards, addCard, sessionAbfahrt, sessionZiel }}>
      {children}
    </AppContext.Provider>
  );
};

// --- 2. LOGIN SCREEN ---
const LoginScreen = ({ navigation }: any) => {
  const { setDriverId } = useContext(AppContext);
  const [pin, setPin] = useState('');

  const handleLogin = () => {
    if (pin.length >= 3) {
      setDriverId(pin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace('Dashboard'); // Wechselt zum Dashboard und löscht Login aus der Historie
    } else {
      Alert.alert('Fehler', 'Bitte gib eine gültige Fahrer-ID / PIN ein.');
    }
  };

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={styles.loginBox}>
        <Text style={styles.loginLogo}>NKG</Text>
        <Text style={styles.loginSubtitle}>Fahrer-Terminal</Text>
        
        <TextInput 
          style={styles.loginInput} 
          placeholder="Fahrer-ID / PIN (z.B. 1234)" 
          placeholderTextColor="#999"
          keyboardType="number-pad" 
          value={pin} 
          onChangeText={setPin} 
          secureTextEntry
        />
        
        <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
          <Text style={styles.loginButtonText}>Anmelden</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// --- 3. DASHBOARD SCREEN ---
const DashboardScreen = ({ navigation }: any) => {
  const { driverId, scannedCards } = useContext(AppContext);

  return (
    <SafeAreaView style={styles.dashboardContainer}>
      <View style={styles.dashboardHeader}>
        <Text style={styles.dashboardWelcome}>Gute Fahrt, Fahrer #{driverId}</Text>
        <Text style={styles.dashboardDate}>{new Date().toLocaleDateString('de-AT')}</Text>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.statsNumber}>{scannedCards.length}</Text>
        <Text style={styles.statsLabel}>Karten in dieser Schicht erfasst</Text>
      </View>

      <View style={styles.dashboardButtons}>
        <TouchableOpacity style={[styles.dashboardBtn, { backgroundColor: '#e91e63' }]} onPress={() => navigation.navigate('Scanner')}>
          <Text style={styles.dashboardBtnText}>📸 Neuen Scan starten</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.dashboardBtn, { backgroundColor: '#333', marginTop: 15 }]} onPress={() => alert('Der CSV-Export kommt morgen dran!')}>
          <Text style={styles.dashboardBtnText}>📤 Tagesdaten exportieren (CSV)</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// --- 4. SCANNER SCREEN (Unser Code von vorhin) ---
const ScannerScreen = ({ navigation }: any) => {
  const { addCard, scannedCards, sessionAbfahrt, sessionZiel } = useContext(AppContext);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [statusColor, setStatusColor] = useState<'green' | 'yellow' | 'red' | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#e91e63" /></View>;
  if (!permission.granted) return (
    <View style={styles.centerContainer}>
      <Text style={styles.permissionText}>Kamera-Zugriff benötigt.</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}><Text style={styles.buttonText}>Kamera erlauben</Text></TouchableOpacity>
    </View>
  );

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      if (photo) {
        setCapturedImage(photo.uri);
        setImageBase64(photo.base64 || null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  };

  const resetScanner = () => { setCapturedImage(null); setImageBase64(null); setEditData(null); setStatusColor(null); };

  const evaluateData = (data: any) => {
    const hasName = data.vorname || data.nachname;
    const hasValidEmail = data.email && data.email.includes('@');
    if (!hasName && !data.email) return 'red';
    if (hasName && hasValidEmail) return 'green';
    return 'yellow';
  };

  const analyzeImage = async () => {
    if (!imageBase64) return;
    setIsScanning(true);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.0,
          messages: [
            { role: 'user', content: [
                { type: 'text', text: 'Du bist ein präziser Daten-Extraktor. Lies die Felder auf diesem Bild. Rate niemals. Wenn ein Wort unleserlich oder leer ist, gib null aus. Gib AUSSCHLIESSLICH ein valides JSON-Objekt zurück mit den Schlüsseln: vorname, nachname, email, telefon, abfahrt, ziel, newsletter (als boolean true/false). Kein Markdown.' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
              ] }
          ],
          max_tokens: 300,
        })
      });
      const data = await response.json();
      if (data.error) { Alert.alert('API Fehler', data.error.message); return; }
      const cleanJson = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanJson);
      
      // Nutze die Session-Daten vom AppContext
      if (sessionAbfahrt) parsedData.abfahrt = sessionAbfahrt;
      if (sessionZiel) parsedData.ziel = sessionZiel;

      setEditData(parsedData);
      setStatusColor(evaluateData(parsedData));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Fehler', 'Scan fehlgeschlagen.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveAndNext = () => {
    addCard(editData);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    resetScanner();
    // Wenn der Fahrer fertig ist, könnte er über eine Zurück-Geste von Android wieder aufs Dashboard.
  };

  return (
    <View style={styles.mainContainer}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Karten gescannt: {scannedCards.length}</Text>
        </View>

        {capturedImage ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: capturedImage }} style={styles.previewImage} />
            {editData && (
              <View style={[styles.dataCard, { borderColor: statusColor === 'green' ? '#2ecc71' : statusColor === 'yellow' ? '#f1c40f' : '#e74c3c' }]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.dataCardTitle}>Daten prüfen</Text>
                  <Text style={{ fontSize: 24 }}>{statusColor === 'green' ? '🟢' : statusColor === 'yellow' ? '🟡' : '🔴'}</Text>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.label}>Vorname & Nachname</Text>
                  <View style={styles.row}>
                    <TextInput style={[styles.input, { flex: 1, marginRight: 5 }]} value={editData.vorname || ''} onChangeText={(text) => setEditData({...editData, vorname: text})} placeholder="Vorname" />
                    <TextInput style={[styles.input, { flex: 1, marginLeft: 5 }]} value={editData.nachname || ''} onChangeText={(text) => setEditData({...editData, nachname: text})} placeholder="Nachname" />
                  </View>
                  <Text style={styles.label}>E-Mail Adresse</Text>
                  <TextInput style={styles.input} value={editData.email || ''} onChangeText={(text) => setEditData({...editData, email: text})} keyboardType="email-address" autoCapitalize="none" />
                  <Text style={styles.label}>Telefon (Optional)</Text>
                  <TextInput style={styles.input} value={editData.telefon || ''} onChangeText={(text) => setEditData({...editData, telefon: text})} keyboardType="phone-pad" />
                  <Text style={styles.label}>Fahrt (Abfahrt ➔ Ziel)</Text>
                  <View style={styles.row}>
                    <TextInput style={[styles.input, { flex: 1, marginRight: 5 }]} value={editData.abfahrt || ''} onChangeText={(text) => setEditData({...editData, abfahrt: text})} placeholder="Abfahrt" />
                    <TextInput style={[styles.input, { flex: 1, marginLeft: 5 }]} value={editData.ziel || ''} onChangeText={(text) => setEditData({...editData, ziel: text})} placeholder="Ziel" />
                  </View>
                </ScrollView>
              </View>
            )}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#333', marginRight: 10 }]} onPress={resetScanner} disabled={isScanning}>
                <Text style={styles.buttonText}>Abbrechen</Text>
              </TouchableOpacity>
              {!editData ? (
                <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#e91e63', opacity: isScanning ? 0.7 : 1 }]} onPress={analyzeImage} disabled={isScanning}>
                  {isScanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Auswerten</Text>}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#2ecc71' }]} onPress={handleSaveAndNext}>
                  <Text style={styles.buttonText}>Speichern & Nächste</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <CameraView style={styles.camera} facing="back" ref={cameraRef}>
            <View style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.instructionText}>Gewinnspielkarte im Rahmen platzieren</Text>
            </View>
            <View style={styles.bottomBar}>
              <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>
            </View>
          </CameraView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
};

// --- NAVIGATION SETUP ---
const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <AppProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="Scanner" component={ScannerScreen} options={{ headerShown: true, title: 'NKG Scanner', headerStyle: { backgroundColor: '#111' }, headerTintColor: '#fff' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: '#000' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 20 },
  permissionText: { fontSize: 16, textAlign: 'center', marginBottom: 20, color: '#333' },
  camera: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  scanFrame: { width: '90%', height: 250, borderWidth: 2, borderColor: '#e91e63', backgroundColor: 'transparent', borderRadius: 10 },
  instructionText: { color: '#fff', marginTop: 20, fontSize: 16, fontWeight: 'bold' },
  bottomBar: { height: 140, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', paddingBottom: 20 },
  captureButton: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255, 255, 255, 0.3)', justifyContent: 'center', alignItems: 'center' },
  captureButtonInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  previewContainer: { flex: 1, backgroundColor: '#000' },
  previewImage: { flex: 1, resizeMode: 'cover' },
  actionButtons: { flexDirection: 'row', paddingHorizontal: 15, paddingTop: 15, paddingBottom: Platform.OS === 'android' ? 30 : 40, backgroundColor: '#111' },
  primaryButton: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 60, paddingVertical: 10, paddingHorizontal: 5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  dataCard: { position: 'absolute', top: 20, left: 15, right: 15, backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: 12, padding: 20, maxHeight: '70%', borderWidth: 3, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  dataCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  label: { fontSize: 12, color: '#666', marginTop: 10, marginBottom: 4, fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  input: { backgroundColor: '#f0f0f0', borderRadius: 6, padding: 10, fontSize: 16, color: '#333', borderWidth: 1, borderColor: '#ddd' },
  header: { backgroundColor: '#111', padding: 10, alignItems: 'center' },
  headerText: { color: '#fff', fontWeight: 'bold' },
  
  // Styles für Login und Dashboard
  loginContainer: { flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  loginBox: { width: '80%', alignItems: 'center', backgroundColor: '#222', padding: 30, borderRadius: 15, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, elevation: 10 },
  loginLogo: { fontSize: 40, fontWeight: '900', color: '#e91e63', marginBottom: 5 },
  loginSubtitle: { color: '#bbb', fontSize: 16, marginBottom: 30 },
  loginInput: { width: '100%', backgroundColor: '#333', color: '#fff', padding: 15, borderRadius: 8, fontSize: 18, textAlign: 'center', marginBottom: 20 },
  loginButton: { backgroundColor: '#e91e63', width: '100%', padding: 15, borderRadius: 8, alignItems: 'center' },
  loginButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  dashboardContainer: { flex: 1, backgroundColor: '#f5f5f5', padding: 20, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 20 : 50 },
  dashboardHeader: { marginBottom: 30 },
  dashboardWelcome: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  dashboardDate: { fontSize: 16, color: '#666', marginTop: 5 },
  statsCard: { backgroundColor: '#fff', padding: 30, borderRadius: 15, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5, marginBottom: 40 },
  statsNumber: { fontSize: 60, fontWeight: '900', color: '#e91e63' },
  statsLabel: { fontSize: 16, color: '#666', marginTop: 10 },
  dashboardButtons: { flex: 1 },
  dashboardBtn: { padding: 20, borderRadius: 10, alignItems: 'center' },
  dashboardBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});