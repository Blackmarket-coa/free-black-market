import { useState } from "react"
import { Link } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Button,
  Badge,
  Input,
  Select,
  toast,
} from "@medusajs/ui"
import { ArrowRight } from "@medusajs/icons"
import {
  useCollectives,
  useFormCollective,
  useQuestCatalog,
} from "../../../hooks/api/quests"

const CollectivesListPage = () => {
  const { data: collectivesData, isLoading } = useCollectives()
  const { data: catalogData } = useQuestCatalog()
  const form = useFormCollective()

  const collectiveQuests = (catalogData?.quests ?? []).filter((q) => q.type === "collective")
  const [questKey, setQuestKey] = useState<string>("")
  const [title, setTitle] = useState<string>("")

  const handleForm = async () => {
    if (!questKey || !title) {
      toast.error("Pick a quest and enter a name")
      return
    }
    try {
      await form.mutateAsync({ quest_key: questKey, title })
      setTitle("")
      toast.success("Collective formed")
    } catch {
      toast.error("Could not form collective")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <Heading level="h1">Collectives</Heading>
        <Text className="text-ui-fg-subtle">
          Pool records with other vendors toward a shared outcome — form a
          cooperative, pool land, or route surplus to the commons. Your records
          are aggregated only after you give scoped consent, and never shared
          with anyone outside the collective.
        </Text>
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">
          Start a collective
        </Heading>
        {collectiveQuests.length === 0 ? (
          <Text className="text-ui-fg-subtle">No collective quests available.</Text>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Text size="small" className="mb-1">
                Quest
              </Text>
              <Select value={questKey} onValueChange={setQuestKey}>
                <Select.Trigger>
                  <Select.Value placeholder="Choose a collective quest" />
                </Select.Trigger>
                <Select.Content>
                  {collectiveQuests.map((q) => (
                    <Select.Item key={q.key} value={q.key}>
                      {q.title}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="flex-1">
              <Text size="small" className="mb-1">
                Name
              </Text>
              <Input
                value={title}
                placeholder="e.g. Piedmont Growers Co-op"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <Button onClick={handleForm} isLoading={form.isPending}>
              Form collective
            </Button>
          </div>
        )}
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">
          Your collectives
        </Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : (collectivesData?.collectives ?? []).length === 0 ? (
          <Text className="text-ui-fg-subtle">
            You're not in any collective yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {collectivesData!.collectives.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Text weight="plus">{c.title}</Text>
                    <Badge size="2xsmall" color="grey">
                      {c.status}
                    </Badge>
                  </div>
                  <Text size="small" className="text-ui-fg-subtle">
                    {c.quest_key}
                  </Text>
                </div>
                <Button size="small" variant="secondary" asChild>
                  <Link to={`/quests/collectives/${c.id}`}>
                    Open <ArrowRight />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </Container>
    </div>
  )
}

export default CollectivesListPage
