import * as fs from 'fs'
import * as sh from 'shelljs'
import * as tmp from 'tmp'
import test from 'ava'
import { createNamespace, waitForDeploymentReplicaCount } from './helpers';

const gcpKey = process.env['GCP_SP_KEY'] || ''
const testNamespace = 'gcp-storage-test'
const bucketName = 'keda-test-storage-bucket'
const deploymentName = 'dummy-storage-consumer'
const maxReplicaCount = '3'
const gsPrefix = `kubectl exec --namespace ${testNamespace} deploy/gcp-sdk -- `

test.before(t => {
    createNamespace(testNamespace)

    // deploy dummy consumer app, scaled object etc.
    const tmpFile = tmp.fileSync()
    fs.writeFileSync(tmpFile.name, deployYaml.replace("{{GCP_CREDS}}", Buffer.from(gcpKey).toString("base64")))

    t.is(
        0,
        sh.exec(`kubectl apply -f ${tmpFile.name} --namespace ${testNamespace}`).code,
        'creating a deployment should work..'
    )
})

test.serial('Deployment should have 0 replicas on start', async t => {
  t.true(await waitForDeploymentReplicaCount(0, deploymentName, testNamespace, 30, 2000), 'replica count should start out as 0')
})

test.serial('creating the gcp-sdk pod should work..', async t => {
    let tmpFile = tmp.fileSync()
    fs.writeFileSync(tmpFile.name, gcpSdkYaml)
    t.is(
        0,
        sh.exec(`kubectl apply -f ${tmpFile.name} --namespace ${testNamespace}`).code,
        'creating the gcp-sdk pod should work..'
    )

    // wait for the gcp-sdk pod to be ready
    t.true(await waitForDeploymentReplicaCount(1, 'gcp-sdk', testNamespace, 30, 2000), 'GCP-SDK pod is not in a ready state')
})

test.serial('initializing the gcp-sdk pod should work..', t => {
    sh.exec(`kubectl wait --for=condition=ready --namespace ${testNamespace} pod -l app=gcp-sdk --timeout=30s`)
    sh.exec('sleep 5s')

    // Authenticate to GCP
    const creds = JSON.parse(gcpKey)
    t.is(
        0,
        sh.exec(gsPrefix + `gcloud auth activate-service-account ${creds.client_email} --key-file /etc/secret-volume/creds.json --project=${creds.project_id}`).code,
        'Setting GCP authentication on gcp-sdk should work..'
    )

    // Cleanup the bucket
    sh.exec(gsPrefix + `gsutil -m rm -r gs://${bucketName}`)

    // Create bucket
    t.is(
      0,
      sh.exec(gsPrefix + `gsutil mb gs://${bucketName}`).code,
      'Creating GCS bucket should work'
    )
})

test.serial(`Uploading objects to GCS bucket`, t => {
    for (let i = 0; i < 30; i++) {
      t.is(
          0,
          sh.exec(gsPrefix + `gsutil cp -n /usr/lib/google-cloud-sdk/bin/gsutil gs://${bucketName}/gsutil` + i).code,
          'Copying an object should work..'
      )
    }
})

test.serial(`Deployment should scale to ${maxReplicaCount} (the max) then back to 0`, async t => {
    // Wait for the number of replicas to be scaled up to maxReplicaCount
    t.true(
      await waitForDeploymentReplicaCount(parseInt(maxReplicaCount, 10), deploymentName, testNamespace, 60, 2000),
      `Replica count should be ${maxReplicaCount} after 120 seconds`)
})

test.serial(`Deleting objects from GCS bucket`, t => {
    t.is(
        0,
        sh.exec(gsPrefix + `gsutil -m rm -a gs://${bucketName}/**`).code,
        'Deleting objects should work..'
    )
})

test.serial(`Deployment should scale back to 0`, async t => {
    t.true(
      await waitForDeploymentReplicaCount(0, deploymentName, testNamespace, 30, 10000),
      `Replica count should be 0 after 5 minutes`)
})

test.after.always.cb('clean up', t => {
    // Cleanup the bucket
    sh.exec(gsPrefix + `gsutil -m rm -r gs://${bucketName}`)

    sh.exec(`kubectl delete deployment.apps/${deploymentName} --namespace ${testNamespace}`)
    sh.exec(`kubectl delete namespace ${testNamespace}`)

    t.end()
})


const deployYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${deploymentName}
  namespace: ${testNamespace}
  labels:
    app: ${deploymentName}
spec:
  replicas: 0
  selector:
    matchLabels:
      app: ${deploymentName}
  template:
    metadata:
      labels:
        app: ${deploymentName}
    spec:
      containers:
        - name: noop-processor
          image: ubuntu:20.04
          command: ["/bin/bash", "-c", "--"]
          args: ["sleep 10"]
          env:
            - name: GOOGLE_APPLICATION_CREDENTIALS_JSON
              valueFrom:
                secretKeyRef:
                  name: gcp-storage-secrets
                  key: creds.json
---
apiVersion: v1
kind: Secret
metadata:
  name: gcp-storage-secrets
type: Opaque
data:
  creds.json: {{GCP_CREDS}}
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: test-scaledobject
spec:
  scaleTargetRef:
    name: ${deploymentName}
  pollingInterval: 5
  maxReplicaCount: ${maxReplicaCount}
  cooldownPeriod: 10
  triggers:
    - type: gcp-storage
      metadata:
        bucketName: ${bucketName}
        targetObjectCount: '5'
        credentialsFromEnv: GOOGLE_APPLICATION_CREDENTIALS_JSON
`

const gcpSdkYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gcp-sdk
  namespace: ${testNamespace}
  labels:
    app: gcp-sdk
spec:
  replicas: 1
  selector:
    matchLabels:
      app: gcp-sdk
  template:
    metadata:
      labels:
        app: gcp-sdk
    spec:
      containers:
        - name: gcp-sdk-container
          image: google/cloud-sdk:slim
          # Just spin & wait forever
          command: [ "/bin/bash", "-c", "--" ]
          args: [ "ls /tmp && while true; do sleep 30; done;" ]
          volumeMounts:
            - name: secret-volume
              mountPath: /etc/secret-volume
      volumes:
        - name: secret-volume
          secret:
            secretName: gcp-storage-secrets
`
