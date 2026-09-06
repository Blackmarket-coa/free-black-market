import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Select,
  Table,
  Badge,
  IconButton,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import {
  useVaultDocuments,
  useCreateVaultDocument,
  useDeleteVaultDocument,
  useUploadVaultFile,
  type VaultDocType,
} from "../../hooks/api/vault"
import { describeVaultStatus } from "../../lib/vault-status"

const DOC_TYPES: VaultDocType[] = [
  "lease",
  "contract",
  "license",
  "insurance",
  "credential",
  "business_plan",
  "other",
]

const VaultPage = () => {
  const { data, isLoading } = useVaultDocuments()
  const create = useCreateVaultDocument()
  const del = useDeleteVaultDocument()
  const upload = useUploadVaultFile()
  const prompt = usePrompt()

  const [label, setLabel] = useState("")
  const [docType, setDocType] = useState<VaultDocType>("license")
  const [expires, setExpires] = useState("")
  const [file, setFile] = useState<File | null>(null)

  const handleCreate = async () => {
    if (!label) {
      toast.error("Give the document a label")
      return
    }
    try {
      let file_id: string | undefined
      if (file) {
        const res = await upload.mutateAsync(file)
        file_id = res.file_id
      }
      await create.mutateAsync({
        label,
        doc_type: docType,
        file_id,
        expires_at: expires || undefined,
      })
      toast.success("Document added")
      setLabel("")
      setExpires("")
      setFile(null)
    } catch {
      toast.error("Could not add document")
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await prompt({
      title: "Remove document",
      description: "Remove this document from your vault?",
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!ok) return
    try {
      await del.mutateAsync(id)
      toast.success("Removed")
    } catch {
      toast.error("Could not remove")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <Heading level="h1">Document Vault</Heading>
        <Text className="text-ui-fg-subtle">
          Store leases, licenses, insurance certificates, and credentials. Quests
          reference these as evidence. Verification is done by an FBM reviewer —
          it is never auto-set — and a verified document stops counting the day
          it expires.
        </Text>
      </Container>

      <Container>
        <Heading level="h2" className="mb-3">Add a document</Heading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Text size="small" className="mb-1">Label</Text>
            <Input value={label} placeholder="2026 Land lease" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Type</Text>
            <Select value={docType} onValueChange={(v) => setDocType(v as VaultDocType)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {DOC_TYPES.map((t) => (
                  <Select.Item key={t} value={t}>
                    {t}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Text size="small" className="mb-1">Expires (optional)</Text>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">File (optional)</Text>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={handleCreate} isLoading={create.isPending || upload.isPending}>
            Add document
          </Button>
        </div>
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">Your documents</Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : (data?.documents ?? []).length === 0 ? (
          <Text className="text-ui-fg-subtle">No documents yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Label</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Expires</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data!.documents.map((d) => (
                <Table.Row key={d.id}>
                  <Table.Cell>{d.label}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{d.doc_type}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {(() => {
                      // The API's `effective_status`, not the stored flag: a
                      // lapsed certificate must read "Expired" here before a
                      // buyer or a quest predicate stops counting it.
                      const status = describeVaultStatus(d)
                      return (
                        <Badge size="2xsmall" color={status.color}>
                          {status.label}
                        </Badge>
                      )
                    })()}
                  </Table.Cell>
                  <Table.Cell>
                    {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    <IconButton size="small" variant="transparent" onClick={() => handleDelete(d.id)}>
                      <Trash />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export default VaultPage
