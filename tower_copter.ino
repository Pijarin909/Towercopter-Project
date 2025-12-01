#include <ESP32Servo.h>

#define ESCPIN 18
#define trigPin 5
#define echoPin 4

Servo esc;

float duration, distance;
float kp = 4.0;
float ki = 0.8;
float kd = 1.5;

float totalError = 0;
float lastError = 0;
long prevT = 0;

// SETPOINT 
float setPoint = 25;   // cm

// batas PWM ESC
int pwmMin = 1100;
int pwmMax = 1900;

// FUNGSI SETPOINT
void setSetpoint(float sp) {
  setPoint = sp;
}

// FUNGSI SET PID
void setPID(float p, float i, float d) {
  kp = p;
  ki = i;
  kd = d;
  totalError = 0;
  lastError = 0; 
}

// BACA ULTRASONIC
void bacaJarak() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  duration = pulseIn(echoPin, HIGH, 20000);
  distance = (duration * 0.0343 / 2);
  

  if (distance > 100 || distance < 0) {
    distance = setPoint;
  }
}


void serialInput() {
  if (!Serial.available()) return;

  String input = Serial.readStringUntil('\n');
  input.trim();

  if (input.startsWith("SETPOINT:")) {
    float newSP = input.substring(9).toFloat();
    if (newSP > 0 && newSP <= 50) { 
      setSetpoint(newSP);
      Serial.print("Setpoint: ");
      Serial.println(setPoint);
    }
    return;
  }

  if (input.startsWith("PID:")) {
    String pidParams = input.substring(4);
    int firstComma = pidParams.indexOf(',');
    int secondComma = pidParams.indexOf(',', firstComma + 1);
    
    if (firstComma != -1 && secondComma != -1) {
      float kpBaru = pidParams.substring(0, firstComma).toFloat();
      float kiBaru = pidParams.substring(firstComma + 1, secondComma).toFloat();
      float kdBaru = pidParams.substring(secondComma + 1).toFloat();
      
      setPID(kpBaru, kiBaru, kdBaru);
      
      Serial.print("PID Updated - Kp: ");
      Serial.print(kp);
      Serial.print(", Ki: ");
      Serial.print(ki);
      Serial.print(", Kd: ");
      Serial.println(kd);
    }
    return;
  }

  Serial.println("Unknown command");
}

void setup() {
  Serial.begin(115200);

  esc.attach(ESCPIN, 1000, 2000);
  esc.writeMicroseconds(1000);
  delay(2000);

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  prevT = millis();


  setSetpoint(30);
  setPID(4.0, 0.8, 1.5);
  
  Serial.println("ESP32 Ready - Towercopter Control");
}

void loop() {
  serialInput();  

  bacaJarak();

  long currT = millis();
  float deltaT = (currT - prevT) / 1000.0;
  prevT = currT;


  float error = setPoint - distance;

  float p = kp * error;
  float i = ki * totalError;
  float d = kd * (error - lastError) / deltaT;
  lastError = error;


  int pwm = 1600 + p + i + d;

  // Anti-windup untuk integral
  if (pwm < pwmMax && pwm > pwmMin) {
    totalError += error * deltaT;
  }

  // Batasan PWM
  if (pwm < pwmMin) pwm = pwmMin;
  if (pwm > pwmMax) pwm = pwmMax;

  esc.writeMicroseconds(pwm);

  // Kirim data ketinggian ke web (hanya nilai distance)
  Serial.println(distance, 2); // 2 decimal places

  delay(50);
}